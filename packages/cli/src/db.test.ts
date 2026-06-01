import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  VotingResults,
  WithSeats,
  PartyList,
  WithAdjustedRank,
} from '@election-night/core/types';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Results = ElectorateResults & WithLeaders & WithMarginOfError;
type PartyVoteSummary = VotingResults & WithSeats;
type PartyListEntry = PartyList & WithAdjustedRank;

function makeResult(overrides: Partial<Results> = {}): Results {
  return {
    electorateName: 'Test Electorate',
    partyVotes: [{ candidate: 'National Party', votes: 5000 }],
    candidateVotes: [
      { candidate: 'Smith, John', party: 'National Party', votes: 5200 },
      { candidate: 'Jones, Mary', party: 'Labour Party', votes: 4800 },
    ],
    votesCounted: 10000,
    votePercentageCounted: 0.8,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 400,
      marginPercent: 0.04,
      isPredictedWinner: false,
    },
    marginOfError: 0.02,
    ...overrides,
  };
}

function makePartyVote(
  overrides: Partial<PartyVoteSummary> = {}
): PartyVoteSummary {
  return {
    candidate: 'National Party',
    votes: 10000,
    seats: 50,
    electorateSeats: 40,
    listSeats: 10,
    ...overrides,
  };
}

function makePartyList(
  overrides: Partial<PartyListEntry> = {}
): PartyListEntry {
  return {
    party: 'National Party',
    candidate: 'Smith, John',
    listRank: 1,
    adjustedRank: 1,
    distanceFromCut: 0.5,
    ...overrides,
  };
}

describe('db', () => {
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'election-night-test-'));
    dbPath = join(tmpDir, 'test.db');
    const { openDb } = await import('./db.js');
    openDb(dbPath);
  });

  afterEach(async () => {
    const { closeDb } = await import('./db.js');
    closeDb();
    if (existsSync(dbPath)) {
      rmSync(dbPath, { force: true });
    }
  });

  test('creates database tables on open', async () => {
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const tables = conn
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    conn.close();

    const names = tables.map((t) => t.name);
    expect(names).toContain('scrape_snapshots');
    expect(names).toContain('electorate_results');
    expect(names).toContain('electorate_summary');
    expect(names).toContain('party_vote_results');
    expect(names).toContain('party_vote_summary');
    expect(names).toContain('party_lists');
  });

  test('writeResults inserts a scrape snapshot', async () => {
    const { writeResults } = await import('./db.js');

    writeResults([makeResult()], [], []);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const snapshots = conn
      .prepare('SELECT id, started_at FROM scrape_snapshots')
      .all() as { id: number; started_at: string }[];
    conn.close();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].started_at).toBeTruthy();
  });

  test('writeResults stores electorate summary data', async () => {
    const { writeResults } = await import('./db.js');
    const result = makeResult();
    writeResults([result], [], []);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare(
        `SELECT s.electorate, s.votes_counted, s.vote_pct_counted,
                s.leading_candidate, s.leading_party
         FROM electorate_summary s
         JOIN scrape_snapshots sn ON sn.id = s.scrape_id
         WHERE sn.id = (SELECT MAX(id) FROM scrape_snapshots)`
      )
      .all() as {
      electorate: string;
      votes_counted: number;
      vote_pct_counted: number;
      leading_candidate: string;
      leading_party: string;
    }[];
    conn.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].electorate).toBe('Test Electorate');
    expect(rows[0].votes_counted).toBe(10000);
    expect(rows[0].leading_candidate).toBe('Smith, John');
    expect(rows[0].leading_party).toBe('National Party');
  });

  test('writeResults stores candidate votes with prediction flag', async () => {
    const { writeResults } = await import('./db.js');
    const result = makeResult({
      leaders: {
        leadingCandidate: 'Smith, John',
        leadingCandidateParty: 'National Party',
        secondCandidate: 'Jones, Mary',
        secondCandidateParty: 'Labour Party',
        margin: 400,
        marginPercent: 0.04,
        isPredictedWinner: true,
      },
    });
    writeResults([result], [], []);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare(
        `SELECT er.candidate, er.votes, er.is_predicted
         FROM electorate_results er
         JOIN scrape_snapshots sn ON sn.id = er.scrape_id
         WHERE sn.id = (SELECT MAX(id) FROM scrape_snapshots)
         ORDER BY er.votes DESC`
      )
      .all() as { candidate: string; votes: number; is_predicted: number }[];
    conn.close();

    expect(rows[0].candidate).toBe('Smith, John');
    expect(rows[0].is_predicted).toBe(1);
    expect(rows[1].candidate).toBe('Jones, Mary');
    expect(rows[1].is_predicted).toBe(0);
  });

  test('writeResults stores party vote summary with seats', async () => {
    const { writeResults } = await import('./db.js');
    const partyVote = makePartyVote();
    writeResults([], [partyVote], []);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare(
        `SELECT pvs.party, pvs.votes, pvs.seats, pvs.electorate_seats, pvs.list_seats
         FROM party_vote_summary pvs
         JOIN scrape_snapshots sn ON sn.id = pvs.scrape_id
         WHERE sn.id = (SELECT MAX(id) FROM scrape_snapshots)`
      )
      .all() as {
      party: string;
      votes: number;
      seats: number;
      electorate_seats: number;
      list_seats: number;
    }[];
    conn.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe('National Party');
    expect(rows[0].votes).toBe(10000);
    expect(rows[0].seats).toBe(50);
    expect(rows[0].electorate_seats).toBe(40);
    expect(rows[0].list_seats).toBe(10);
  });

  test('writeResults stores party list data', async () => {
    const { writeResults } = await import('./db.js');
    const entry = makePartyList();
    writeResults([], [], [entry]);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare(
        `SELECT pl.party, pl.candidate, pl.list_rank, pl.adjusted_rank, pl.distance_from_cut
         FROM party_lists pl
         JOIN scrape_snapshots sn ON sn.id = pl.scrape_id
         WHERE sn.id = (SELECT MAX(id) FROM scrape_snapshots)`
      )
      .all() as {
      party: string;
      candidate: string;
      list_rank: number;
      adjusted_rank: number;
      distance_from_cut: number;
    }[];
    conn.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe('National Party');
    expect(rows[0].candidate).toBe('Smith, John');
    expect(rows[0].list_rank).toBe(1);
    expect(rows[0].adjusted_rank).toBe(1);
    expect(rows[0].distance_from_cut).toBe(0.5);
  });
});
