/**
 * Smoke-level load check for the history read path.
 *
 * The full benchmark is `packages/collector/scripts/benchmark-history.ts`
 * (opt-in, a full 1,440-snapshot ballot). This test keeps a small version in
 * the suite so a future change cannot quietly reintroduce an N+1: it asserts
 * the query count is constant as the snapshot count grows, that the grouped
 * result is identical to the old per-snapshot read, and that the trailing
 * window and paging are honoured.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  ElectorateResult,
  PartyVoteResult,
} from '@election-night/core/types';
import type {
  CandidateSnapshot,
  PartyVoteSnapshot,
} from '@election-night/core/history';
import {
  queryElectorateHistory,
  queryPartyVoteHistory,
  querySnapshotMetas,
} from './history-queries.js';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SEATS = ['Alpha', 'Bravo', 'Charlie'];

function makeResult(index: number, electorateName: string): ElectorateResult {
  const base = 1_000 + index * 10;
  return {
    electorateName,
    partyVotes: [
      { candidate: 'National Party', votes: base },
      { candidate: 'Labour Party', votes: base - 100 },
    ],
    candidateVotes: [
      { candidate: 'Smith, John', party: 'National Party', votes: base + 50 },
      { candidate: 'Jones, Mary', party: 'Labour Party', votes: base - 50 },
    ],
    votesCounted: base * 2,
    votePercentageCounted: 0.5,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 100,
      marginPercent: 0.01,
    },
  };
}

function makePartyVote(votes: number): PartyVoteResult {
  return {
    candidate: 'National Party',
    votes,
    seats: 50,
    electorateSeats: 40,
    listSeats: 10,
  };
}

/**
 * Count statements by wrapping `prepare` on a proxy. The query functions only
 * touch the connection through this object, so every statement is observed.
 */
function instrument(db: Database.Database) {
  const counts = { prepare: 0, all: 0, get: 0, run: 0 };
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          counts.prepare += 1;
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(stmt, method) {
              const value = Reflect.get(stmt, method);
              if (typeof value !== 'function') return value;
              return (...args: unknown[]) => {
                if (method === 'all' || method === 'get' || method === 'run') {
                  counts[method] += 1;
                }
                return value.apply(stmt, args);
              };
            },
          });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Database.Database;
  return { db: proxy, counts };
}

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

async function seed(snapshots: number): Promise<Database.Database> {
  tmpDir = mkdtempSync(join(tmpdir(), 'history-load-test-'));
  const path = join(tmpDir, 'load.db');
  const { openDb, writeResults, closeDb } = await import('./db.js');
  openDb(path);

  for (let i = 0; i < snapshots; i += 1) {
    writeResults(
      SEATS.map((seat) => makeResult(i, seat)),
      [makePartyVote(10_000 + i)],
      [],
      '2026'
    );
  }
  closeDb();

  // Give each snapshot a distinct, increasing time inside the 24h window so
  // ordering and paging are deterministic.
  const raw = new Database(path);
  const ids = raw
    .prepare('SELECT id FROM scrape_snapshots ORDER BY id')
    .all() as { id: number }[];
  const setTime = raw.prepare(
    "UPDATE scrape_snapshots SET started_at = datetime('now', ?) WHERE id = ?"
  );
  ids.forEach(({ id }, index) => {
    const minutesAgo = (snapshots - index) * 10;
    setTime.run(`-${minutesAgo} minutes`, id);
  });
  raw.close();

  return new Database(path, { readonly: true });
}

/** The pre-Task-02a per-snapshot read, kept here to prove equivalence. */
function legacyElectorateHistory(
  db: Database.Database,
  name: string,
  year: string
) {
  const summaries = db
    .prepare(
      `SELECT ss.id AS snapshotId, ss.election_year AS electionYear,
              ss.started_at AS startedAt, ss.completed_at AS completedAt,
              ss.revision AS revision, ss.model_version AS modelVersion,
              es.votes_counted AS votesCounted, es.vote_pct_counted AS votePctCounted,
              es.leading_candidate AS leadingCandidate, es.leading_party AS leadingParty,
              es.margin AS margin, es.margin_pct AS marginPct
       FROM scrape_snapshots ss
       JOIN electorate_summary es ON es.scrape_id = ss.id
       WHERE es.electorate = ? AND ss.election_year = ?
       ORDER BY ss.started_at ASC`
    )
    .all(name, year) as Record<string, unknown>[];

  return summaries.map((row) => ({
    ...row,
    candidates: db
      .prepare(
        `SELECT candidate, party, votes FROM electorate_results
         WHERE scrape_id = ? AND electorate = ? ORDER BY votes DESC`
      )
      .all(row.snapshotId, name) as CandidateSnapshot[],
    partyVotes: db
      .prepare(
        `SELECT party, votes FROM party_vote_results
         WHERE scrape_id = ? AND electorate = ? ORDER BY votes DESC`
      )
      .all(row.snapshotId, name) as PartyVoteSnapshot[],
  }));
}

describe('history load shape', () => {
  test('query count stays flat as snapshots grow', async () => {
    const db = await seed(24);
    const page = { windowHours: 24, limit: 2_000, offset: 0 };

    const electorate = instrument(db);
    const electoratePage = queryElectorateHistory(
      electorate.db,
      'Alpha',
      '2026',
      page
    );
    expect(electorate.counts.prepare).toBeLessThanOrEqual(3);

    const party = instrument(db);
    const partyPage = queryPartyVoteHistory(party.db, '2026', page);
    expect(party.counts.prepare).toBeLessThanOrEqual(3);

    const snapshots = instrument(db);
    const snapshotPage = querySnapshotMetas(snapshots.db, '2026', page);
    expect(snapshots.counts.prepare).toBe(1);

    expect(electoratePage.rows).toHaveLength(24);
    expect(electoratePage.total).toBe(24);
    expect(partyPage.rows).toHaveLength(24);
    expect(partyPage.total).toBe(24);
    expect(snapshotPage.rows).toHaveLength(24);

    db.close();
  });

  test('grouped reads equal the old per-snapshot reads', async () => {
    const db = await seed(12);
    const page = { windowHours: 24, limit: 2_000, offset: 0 };

    const grouped = queryElectorateHistory(db, 'Alpha', '2026', page);
    const legacy = legacyElectorateHistory(db, 'Alpha', '2026');
    expect(grouped.rows).toEqual(legacy);

    db.close();
  });

  test('pages with an explicit limit and offset without truncating silently', async () => {
    const db = await seed(12);
    const all = queryElectorateHistory(db, 'Alpha', '2026', {
      windowHours: 24,
      limit: 2_000,
      offset: 0,
    });
    const result = queryElectorateHistory(db, 'Alpha', '2026', {
      windowHours: 24,
      limit: 4,
      offset: 4,
    });

    expect(result.total).toBe(12);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => row.snapshotId)).toEqual(
      all.rows.slice(4, 8).map((row) => row.snapshotId)
    );

    db.close();
  });

  // The chart asks "what did the last day of counting look like", not "what
  // happened in the last 24 hours of my life". Anchored to now(), a settled
  // count reads as no data at all, which is what the Trends chart showed.
  test('reads the window from the newest snapshot, not the wall clock', async () => {
    const db = await seed(6);
    const raw = new Database(db.name, { readonly: false });
    raw
      .prepare(
        "UPDATE scrape_snapshots SET started_at = datetime(started_at, '-7 days')"
      )
      .run();
    raw.close();

    const result = queryPartyVoteHistory(db, '2026', {
      windowHours: 24,
      limit: 2_000,
      offset: 0,
    });

    expect(result.total).toBe(6);
    expect(result.rows).toHaveLength(6);

    db.close();
  });

  test('excludes snapshots older than the window', async () => {
    const db = await seed(6);
    const raw = new Database(db.name, { readonly: false });
    raw
      .prepare(
        "UPDATE scrape_snapshots SET started_at = datetime('now', '-25 hours') WHERE id = (SELECT MIN(id) FROM scrape_snapshots)"
      )
      .run();
    raw.close();

    const result = queryElectorateHistory(db, 'Alpha', '2026', {
      windowHours: 24,
      limit: 2_000,
      offset: 0,
    });
    expect(result.total).toBe(5);
    expect(result.rows).toHaveLength(5);

    db.close();
  });
});
