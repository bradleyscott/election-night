import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
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
      predictionStatus: 'too-close',
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

    writeResults([makeResult()], [], [], '2026');

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const snapshots = conn
      .prepare('SELECT id, election_year, started_at FROM scrape_snapshots')
      .all() as {
      id: number;
      election_year: string | null;
      started_at: string;
    }[];
    conn.close();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].election_year).toBe('2026');
    expect(snapshots[0].started_at).toBeTruthy();
  });

  test('records the election year on every snapshot so cycles stay separable', async () => {
    const { writeResults } = await import('./db.js');

    writeResults([makeResult()], [], [], '2023');
    writeResults([makeResult()], [], [], '2026');

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const years = conn
      .prepare('SELECT election_year FROM scrape_snapshots ORDER BY id')
      .all() as { election_year: string }[];
    conn.close();

    expect(years.map((r) => r.election_year)).toEqual(['2023', '2026']);
  });

  test('writeResults stores electorate summary data', async () => {
    const { writeResults } = await import('./db.js');
    const result = makeResult();
    writeResults([result], [], [], '2026');

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
        predictionStatus: 'projected',
      },
    });
    writeResults([result], [], [], '2026');

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
    writeResults([], [partyVote], [], '2026');

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
    writeResults([], [], [entry], '2026');

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

describe('pruneSnapshots', () => {
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'election-night-prune-'));
    dbPath = join(tmpDir, 'test.db');
    const { openDb } = await import('./db.js');
    openDb(dbPath);
  });

  afterEach(async () => {
    const { closeDb } = await import('./db.js');
    closeDb();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  });

  /** Writes `count` snapshots and backdates them by `hours`. */
  async function writeSnapshots(count: number, backdateHours: number) {
    const { writeResults } = await import('./db.js');
    for (let i = 0; i < count; i += 1) {
      writeResults([makeResult()], [makePartyVote()], [makePartyList()], '2026');
    }
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    conn
      .prepare(
        "UPDATE scrape_snapshots SET started_at = datetime(started_at, ?) WHERE id <= ?"
      )
      .run(`-${backdateHours} hours`, count);
    conn.close();
  }

  async function snapshotIds(): Promise<number[]> {
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare('SELECT id FROM scrape_snapshots ORDER BY id')
      .all() as { id: number }[];
    conn.close();
    return rows.map((r) => r.id);
  }

  async function childRowCounts(): Promise<Record<string, number>> {
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const counts: Record<string, number> = {};
    for (const table of [
      'electorate_results',
      'electorate_summary',
      'party_vote_results',
      'party_vote_summary',
      'party_lists',
    ]) {
      counts[table] = (
        conn.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }
      ).c;
    }
    conn.close();
    return counts;
  }

  test('deletes snapshots older than the window, oldest first', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(3, 48); // old
    await writeSnapshots(2, 1); // recent

    const result = pruneSnapshots(24);

    expect(result).toEqual({ deletedSnapshots: 3, stoppedEarly: false });
    expect(await snapshotIds()).toHaveLength(2);
  });

  test('takes child rows with it and leaves the kept snapshots intact', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(2, 48);
    await writeSnapshots(2, 1);
    const [oldest] = await snapshotIds();

    pruneSnapshots(24);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const orphans = (
      conn
        .prepare('SELECT count(*) c FROM electorate_results WHERE scrape_id = ?')
        .get(oldest) as { c: number }
    ).c;
    conn.close();

    expect(orphans).toBe(0);
    // The two kept snapshots keep their detail rows (2 candidates each).
    expect((await childRowCounts()).electorate_results).toBe(4);
  });

  test('prunes across batches without losing rows', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(7, 48);
    await writeSnapshots(1, 1);

    const result = pruneSnapshots(24, 2);

    expect(result.deletedSnapshots).toBe(7);
    expect(await snapshotIds()).toHaveLength(1);
  });

  test('always keeps the newest snapshot, even when everything is stale', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(4, 72);

    const result = pruneSnapshots(24);

    expect(result.deletedSnapshots).toBe(3);
    expect(await snapshotIds()).toHaveLength(1);
  });

  test('does nothing when retention is disabled', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(2, 48);

    expect(pruneSnapshots(0)).toEqual({
      deletedSnapshots: 0,
      stoppedEarly: false,
    });
    expect(await snapshotIds()).toHaveLength(2);
  });
});

describe('compaction', () => {
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'election-night-vacuum-'));
    dbPath = join(tmpDir, 'test.db');
    const { openDb } = await import('./db.js');
    openDb(dbPath);
  });

  afterEach(async () => {
    const { closeDb } = await import('./db.js');
    closeDb();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  });

  async function pageCount(): Promise<number> {
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const count = conn.pragma('page_count', { simple: true }) as number;
    conn.close();
    return count;
  }

  test('enables incremental auto-vacuum, including for an existing file', async () => {
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    expect(conn.pragma('auto_vacuum', { simple: true })).toBe(2);
    conn.close();
  });

  test('upgrades a database that predates incremental auto-vacuum', async () => {
    const Database = (await import('better-sqlite3')).default;
    const legacyPath = join(dirname(dbPath), 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.pragma('auto_vacuum = NONE');
    legacy.exec(
      "create table keep_me (id integer primary key, v text); insert into keep_me (v) values ('row')"
    );
    legacy.close();

    const { openDb, closeDb } = await import('./db.js');
    closeDb(); // release the file opened by beforeEach
    openDb(legacyPath);

    const conn = new Database(legacyPath);
    expect(conn.pragma('auto_vacuum', { simple: true })).toBe(2);
    // The conversion is a VACUUM: it must not cost any data.
    expect(
      (conn.prepare('select count(*) c from keep_me').get() as { c: number }).c
    ).toBe(1);
    conn.close();
  });

  test('returns freed pages to the filesystem after a prune', async () => {
    const { writeResults, pruneSnapshots, compactDatabase } = await import(
      './db.js'
    );
    // Enough snapshots that the file is worth shrinking, then age them out.
    for (let i = 0; i < 60; i += 1) {
      writeResults([makeResult()], [makePartyVote()], [makePartyList()], '2026');
    }
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    conn
      .prepare("UPDATE scrape_snapshots SET started_at = datetime('now', '-48 hours')")
      .run();
    conn.close();

    pruneSnapshots(24);
    const freedPages = compactDatabase();
    // One snapshot is always kept, so the file shrinks but does not vanish.
    expect(freedPages).toBeGreaterThan(0);
    expect(await pageCount()).toBeLessThan(60 * 4);
  });

  test('is a no-op when there is nothing free to reclaim', async () => {
    const { writeResults, compactDatabase } = await import('./db.js');
    writeResults([makeResult()], [makePartyVote()], [makePartyList()], '2026');

    expect(compactDatabase()).toBe(0);
  });
});
