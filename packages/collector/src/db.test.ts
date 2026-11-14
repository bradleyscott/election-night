import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import type {
  ElectorateResult,
  PartyVoteResult,
  PartyListResult,
} from '@election-night/core/types';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeResult(
  overrides: Partial<ElectorateResult> = {}
): ElectorateResult {
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
    },
    ...overrides,
  };
}

function makePartyVote(
  overrides: Partial<PartyVoteResult> = {}
): PartyVoteResult {
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
  overrides: Partial<PartyListResult> = {}
): PartyListResult {
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

  test('writeResults stores candidate votes', async () => {
    const { writeResults } = await import('./db.js');
    const result = makeResult({
      leaders: {
        leadingCandidate: 'Smith, John',
        leadingCandidateParty: 'National Party',
        secondCandidate: 'Jones, Mary',
        secondCandidateParty: 'Labour Party',
        margin: 400,
        marginPercent: 0.04,
      },
    });
    writeResults([result], [], [], '2026');

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare(
        `SELECT er.candidate, er.votes
         FROM electorate_results er
         JOIN scrape_snapshots sn ON sn.id = er.scrape_id
         WHERE sn.id = (SELECT MAX(id) FROM scrape_snapshots)
         ORDER BY er.votes DESC`
      )
      .all() as { candidate: string; votes: number }[];
    conn.close();

    expect(rows[0].candidate).toBe('Smith, John');
    expect(rows[0].votes).toBe(5200);
    expect(rows[1].candidate).toBe('Jones, Mary');
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
      writeResults(
        [makeResult()],
        [makePartyVote()],
        [makePartyList()],
        '2026'
      );
    }
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    conn
      .prepare(
        'UPDATE scrape_snapshots SET started_at = datetime(started_at, ?) WHERE id <= ?'
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

  // The window counts back from the newest snapshot, not from the wall clock.
  // Measured from `now()`, a feed that has been quiet for a week makes every
  // snapshot "older than a day" and the first restart deletes the whole series
  // — which is exactly what happened to the 2026 count.
  test('keeps a day of the count even when the whole series is older than that', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(3, 240); // ten days old, all within a second of each other

    const result = pruneSnapshots(24);

    expect(result).toEqual({ deletedSnapshots: 0, stoppedEarly: false });
    expect(await snapshotIds()).toHaveLength(3);
  });

  test('still deletes a gap older than the window inside the series', async () => {
    const { pruneSnapshots } = await import('./db.js');
    await writeSnapshots(2, 240); // a day-of-count from ten days ago
    await writeSnapshots(2, 1); // and a fresh pair

    const result = pruneSnapshots(24);

    expect(result.deletedSnapshots).toBe(2);
    expect(await snapshotIds()).toHaveLength(2);
  });

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
        .prepare(
          'SELECT count(*) c FROM electorate_results WHERE scrape_id = ?'
        )
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
    // Four snapshots thirty hours apart, all ten days old: the three older
    // than the newest by more than the window go, the newest stays even though
    // it is itself far outside what the wall clock calls "the last 24 hours".
    await writeSnapshots(4, 240);
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    conn
      .prepare(
        "UPDATE scrape_snapshots SET started_at = datetime(started_at, '-' || ((4 - id) * 30) || ' hours')"
      )
      .run();
    conn.close();

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

  test('assigns a cycle revision and stores the full latest payload', async () => {
    const { writeResults } = await import('./db.js');
    writeResults([makeResult()], [makePartyVote()], [makePartyList()], '2026');
    writeResults([makeResult()], [makePartyVote()], [makePartyList()], '2026');

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const snapshots = conn
      .prepare('select revision from scrape_snapshots order by id')
      .all() as { revision: number }[];
    const latest = conn
      .prepare(
        "select revision, payload from latest_state where election_year = '2026'"
      )
      .get() as { revision: number; payload: string };
    conn.close();

    expect(snapshots.map((row) => row.revision)).toEqual([1, 2]);
    expect(latest.revision).toBe(2);
    const payload = JSON.parse(latest.payload);
    // The latest state carries all three collections, not just electorates.
    expect(payload.electorateResults).toHaveLength(1);
    expect(payload.partyVote).toHaveLength(1);
    expect(payload.partyLists).toHaveLength(1);
  });

  test('a retry with the same publication key writes no second snapshot', async () => {
    const { writeSnapshot } = await import('./db.js');
    const write = {
      results: [makeResult()],
      partyVote: [makePartyVote()],
      partyLists: [makePartyList()],
      electionYear: '2026',
      progressByElectorate: { 'Test Electorate': 0.8 },
      publicationKey: 'retry-1',
    };

    const first = writeSnapshot(write);
    const second = writeSnapshot(write);

    expect(second).toBe(first);
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const count = (
      conn.prepare('select count(*) c from scrape_snapshots').get() as {
        c: number;
      }
    ).c;
    const latest = conn
      .prepare("select revision from latest_state where election_year = '2026'")
      .get() as { revision: number };
    conn.close();

    expect(count).toBe(1);
    expect(latest.revision).toBe(1);
  });

  test('a correction A to B to A gets three distinct revisions', async () => {
    const { writeSnapshot } = await import('./db.js');
    const base = {
      partyVote: [makePartyVote()],
      partyLists: [],
      electionYear: '2026',
      progressByElectorate: {},
    };
    const a1 = writeSnapshot({
      ...base,
      results: [makeResult({ votesCounted: 1_000 })],
      publicationKey: 'a-1',
    });
    const b = writeSnapshot({
      ...base,
      results: [makeResult({ votesCounted: 2_000 })],
      publicationKey: 'b-1',
    });
    const a2 = writeSnapshot({
      ...base,
      results: [makeResult({ votesCounted: 1_000 })],
      publicationKey: 'a-2',
    });

    expect(new Set([a1, b, a2]).size).toBe(3);
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const revisions = (
      conn
        .prepare('select revision from scrape_snapshots order by id')
        .all() as { revision: number }[]
    ).map((row) => row.revision);
    const latest = conn
      .prepare(
        "select revision, payload from latest_state where election_year = '2026'"
      )
      .get() as { revision: number; payload: string };
    conn.close();

    expect(revisions).toEqual([1, 2, 3]);
    expect(latest.revision).toBe(3);
    expect(JSON.parse(latest.payload).electorateResults[0].votesCounted).toBe(
      1_000
    );
  });

  test('a zero ballot persists latest state but adds no count snapshot', async () => {
    const { writeLatestState } = await import('./db.js');
    const zero = {
      results: [
        makeResult({ votesCounted: 0, candidateVotes: [], partyVotes: [] }),
      ],
      partyVote: [makePartyVote()],
      partyLists: [makePartyList()],
      electionYear: '2026',
      publicationKey: 'zero-1',
    };

    expect(writeLatestState(zero)).toBe(1);
    // The same key is idempotent: no second revision.
    expect(writeLatestState(zero)).toBe(1);

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const snapshots = (
      conn.prepare('select count(*) c from scrape_snapshots').get() as {
        c: number;
      }
    ).c;
    const latest = conn
      .prepare(
        "select revision, payload from latest_state where election_year = '2026'"
      )
      .get() as { revision: number; payload: string };
    conn.close();

    expect(snapshots).toBe(0);
    expect(latest.revision).toBe(1);
    expect(JSON.parse(latest.payload).partyLists).toHaveLength(1);
  });

  test('a failed write rolls the snapshot and latest state back together', async () => {
    const { writeSnapshot } = await import('./db.js');
    const before = 0;
    expect(() =>
      writeSnapshot({
        results: [makeResult()],
        partyVote: [makePartyVote()],
        // Duplicate primary key inside the transaction.
        partyLists: [makePartyList(), makePartyList()],
        electionYear: '2026',
        progressByElectorate: {},
        publicationKey: 'rollback-1',
      })
    ).toThrow();

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const snapshots = (
      conn.prepare('select count(*) c from scrape_snapshots').get() as {
        c: number;
      }
    ).c;
    const latest = conn
      .prepare(
        "select count(*) c from latest_state where election_year = '2026'"
      )
      .get() as { c: number };
    conn.close();

    expect(snapshots).toBe(before);
    expect(latest.c).toBe(0);
  });

  test('stores webhook announcements with the snapshot and claims them once', async () => {
    const { writeSnapshot, claimWebhookBatch, completeWebhook } =
      await import('./db.js');
    const hook = {
      event: 'leader_change',
      eventId: 'pub:leader_change:Test Electorate',
      electionYear: '2026',
      timestamp: Date.now(),
      electorateName: 'Test Electorate',
      result: makeResult(),
      diff: {},
    } as never;

    const write = {
      results: [makeResult()],
      partyVote: [makePartyVote()],
      partyLists: [],
      electionYear: '2026',
      progressByElectorate: {},
      publicationKey: 'pub',
      webhooks: [hook],
    };
    writeSnapshot(write);
    // An idempotent retry must not enqueue a second copy.
    writeSnapshot(write);

    const first = claimWebhookBatch(10);
    expect(first).toHaveLength(1);
    expect(first[0]!.eventId).toBe('pub:leader_change:Test Electorate');
    expect(first[0]!.attempts).toBe(1);

    // A second claim while the first is leased returns nothing.
    expect(claimWebhookBatch(10)).toHaveLength(0);

    completeWebhook(first[0]!.id, 'delivered');

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const row = conn
      .prepare(
        "select status, delivered_at from webhook_outbox where event_id = 'pub:leader_change:Test Electorate'"
      )
      .get() as { status: string; delivered_at: string | null };
    conn.close();
    expect(row.status).toBe('delivered');
    expect(row.delivered_at).toBeTruthy();
  });

  test('keeps revisions separate per cycle', async () => {
    const { writeResults } = await import('./db.js');
    writeResults([makeResult()], [], [], '2023');
    writeResults([makeResult()], [], [], '2026');

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const rows = conn
      .prepare(
        'select election_year, revision from latest_state order by election_year'
      )
      .all() as { election_year: string; revision: number }[];
    conn.close();

    expect(rows).toEqual([
      { election_year: '2023', revision: 1 },
      { election_year: '2026', revision: 1 },
    ]);
  });

  test('returns freed pages to the filesystem after a prune', async () => {
    const { writeResults, pruneSnapshots, compactDatabase } =
      await import('./db.js');
    // Enough snapshots that the file is worth shrinking, then age them out.
    for (let i = 0; i < 60; i += 1) {
      writeResults(
        [makeResult()],
        [makePartyVote()],
        [makePartyList()],
        '2026'
      );
    }
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    // Spread them over more than a day of count, so the retention window has
    // something to cut: measured from the newest snapshot, the tail falls out.
    conn
      .prepare(
        "UPDATE scrape_snapshots SET started_at = datetime('now', '-240 hours', '-' || (id * 1440) || ' minutes')"
      )
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
