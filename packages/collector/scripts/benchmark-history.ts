/**
 * Offline load benchmark for the history read path.
 *
 * Opt-in; not part of `npm test` (the small equivalent is
 * `src/history-load.test.ts`). It seeds a realistic worst case — a full ballot
 * across 1,440 snapshots, i.e. 24h at a 60s poll — then times the same reads
 * the dashboard makes and reports the two shapes side by side:
 *
 *   - `legacy`: the pre-Task-02a per-snapshot N+1 (kept here as the baseline).
 *   - `grouped`: `src/history-queries.ts`.
 *
 * Run: `npm run bench:history`
 * Quick: `npm run bench:history -- --quick`
 * JSON:  `npm run bench:history -- --json`
 *
 * It writes to a temporary database and deletes it, so it never touches
 * `.data/`.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDb, closeDb, pruneSnapshots } from '../src/db.js';
import {
  queryElectorateHistory,
  queryPartyVoteHistory,
  querySnapshotMetas,
} from '../src/history-queries.js';
import type {
  CandidateSnapshot,
  PartyVoteSnapshot,
} from '@election-night/core/history';

interface Options {
  snapshots: number;
  seats: number;
  candidatesPerSeat: number;
  parties: number;
  iterations: number;
  json: boolean;
  explain: boolean;
}

function parseOptions(argv: string[]): Options {
  const quick = argv.includes('--quick');
  const value = (name: string, fallback: number): number => {
    const arg = argv.find((item) => item.startsWith(`--${name}=`));
    if (!arg) return fallback;
    const parsed = Number(arg.slice(name.length + 3));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    snapshots: value('snapshots', quick ? 120 : 1_440),
    seats: value('seats', quick ? 8 : 71),
    candidatesPerSeat: value('candidates', quick ? 4 : 8),
    parties: value('parties', quick ? 6 : 17),
    iterations: value('iterations', quick ? 5 : 15),
    json: argv.includes('--json'),
    explain: argv.includes('--explain'),
  };
}

function instrument(db: Database.Database) {
  const counts = { prepare: 0, statements: 0 };
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          counts.prepare += 1;
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(stmt, method) {
              const fn = Reflect.get(stmt, method);
              if (typeof fn !== 'function') return fn;
              return (...args: unknown[]) => {
                if (method === 'all' || method === 'get' || method === 'run') {
                  counts.statements += 1;
                }
                return fn.apply(stmt, args);
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index]!;
}

interface ScenarioResult {
  name: string;
  queries: number;
  rows: number;
  bytes: number;
  p50: number;
  p95: number;
  p99: number;
  loopLagMs: number;
}

async function measure(
  name: string,
  db: Database.Database,
  run: (handle: Database.Database) => { rows: number; bytes?: number } | void,
  iterations: number
): Promise<ScenarioResult> {
  const { db: proxy, counts } = instrument(db);
  const times: number[] = [];

  let maxLag = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLag = Math.max(maxLag, now - last);
    last = now;
  }, 1);

  let rows = 0;
  let bytes = 0;
  for (let i = 0; i < iterations; i += 1) {
    // Yield first so the timer can record the previous synchronous block.
    await new Promise<void>((resolve) => setImmediate(resolve));
    last = performance.now();
    const start = performance.now();
    const result = run(proxy);
    times.push(performance.now() - start);
    if (result && 'rows' in result) {
      rows = result.rows;
      bytes = result.bytes ?? bytes;
    }
  }

  await new Promise<void>((resolve) => setImmediate(resolve));
  clearInterval(timer);

  const sorted = [...times].sort((a, b) => a - b);
  return {
    name,
    // Statements per request, not per benchmark run.
    queries: Math.round(counts.prepare / iterations),
    rows,
    bytes,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    loopLagMs: maxLag,
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function seed(path: string, options: Options): void {
  openDb(path);
  closeDb();

  const db = new Database(path);
  const insertSnapshot = db.prepare(
    "INSERT INTO scrape_snapshots (election_year, started_at, completed_at) VALUES (?, datetime('now', ?), datetime('now'))"
  );
  const insertSummary = db.prepare(
    `INSERT INTO electorate_summary
       (scrape_id, electorate, votes_counted, estimated_total_votes,
        vote_pct_counted, leading_candidate, leading_party, margin,
        margin_pct, second_candidate, second_party)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCandidate = db.prepare(
    'INSERT INTO electorate_results (scrape_id, electorate, candidate, party, votes) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPartyVote = db.prepare(
    'INSERT INTO party_vote_results (scrape_id, electorate, party, votes) VALUES (?, ?, ?, ?)'
  );
  const insertPartySummary = db.prepare(
    `INSERT INTO party_vote_summary
       (scrape_id, party, votes, seats, electorate_seats, list_seats)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const seats = Array.from(
    { length: options.seats },
    (_, index) => `Seat ${pad(index + 1)}`
  );
  const parties = Array.from(
    { length: options.parties },
    (_, index) => `Party ${pad(index + 1)}`
  );

  const seedAll = db.transaction(() => {
    // Insert the out-of-window snapshot first so it has the lowest id and is
    // actually eligible for pruning (the newest snapshot is always kept).
    insertSnapshot.run('2026', '-25 hours');

    for (let snapshot = 0; snapshot < options.snapshots; snapshot += 1) {
      const minutesAgo = options.snapshots - snapshot - 1;
      const info = insertSnapshot.run('2026', `-${minutesAgo} minutes`);
      const scrapeId = Number(info.lastInsertRowid);

      seats.forEach((seat, seatIndex) => {
        const base = 1_000 + seatIndex * 37 + snapshot * 7;
        insertSummary.run(
          scrapeId,
          seat,
          base * 2,
          base * 3,
          0.66,
          'Smith, John',
          'Party 01',
          120,
          0.01,
          'Jones, Mary',
          'Party 02'
        );
        for (let c = 0; c < options.candidatesPerSeat; c += 1) {
          insertCandidate.run(
            scrapeId,
            seat,
            `Candidate ${pad(c + 1)}`,
            parties[c % parties.length]!,
            base - c * 11
          );
        }
        for (const party of parties) {
          insertPartyVote.run(
            scrapeId,
            seat,
            party,
            base - Number(party.slice(-2)) * 9
          );
        }
      });

      parties.forEach((party, index) => {
        insertPartySummary.run(
          scrapeId,
          party,
          10_000 - index * 37,
          60 - index,
          40 - index,
          20
        );
      });
    }
  });
  seedAll();

  // Keep the file from growing beyond what the read path would see in
  // production, where retention has already run.
  console.log(
    `Seeded ${options.snapshots} snapshots (${options.seats} seats).`
  );
  db.close();
}

function legacyElectorateHistory(
  db: Database.Database,
  name: string,
  year: string
) {
  const summaries = db
    .prepare(
      `SELECT ss.id AS snapshotId, ss.election_year AS electionYear,
              ss.started_at AS startedAt, ss.completed_at AS completedAt,
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

function legacyPartyVoteHistory(db: Database.Database, year: string) {
  const snapshots = db
    .prepare(
      `SELECT id AS snapshotId, election_year AS electionYear,
              started_at AS startedAt, completed_at AS completedAt
       FROM scrape_snapshots
       WHERE election_year = ?
       ORDER BY started_at ASC`
    )
    .all(year) as Record<string, unknown>[];

  return snapshots.map((snap) => {
    const parties = db
      .prepare(
        `SELECT party, votes, seats, electorate_seats AS electorateSeats,
                list_seats AS listSeats
         FROM party_vote_summary WHERE scrape_id = ? ORDER BY votes DESC`
      )
      .all(snap.snapshotId);
    const counted = db
      .prepare(
        `SELECT COALESCE(SUM(votes_counted), 0) AS votesCounted,
                COALESCE(SUM(estimated_total_votes), 0) AS estimatedTotalVotes
         FROM electorate_summary WHERE scrape_id = ?`
      )
      .get(snap.snapshotId) as Record<string, number>;
    return {
      ...snap,
      votesCounted: counted.votesCounted,
      votePctCounted:
        counted.estimatedTotalVotes > 0
          ? counted.votesCounted / counted.estimatedTotalVotes
          : 0,
      parties,
    };
  });
}

function printTable(results: ScenarioResult[]): void {
  const header =
    '| Scenario | Statements | Rows | Bytes | p50 ms | p95 ms | p99 ms | max loop lag ms |';
  console.log(header);
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of results) {
    console.log(
      `| ${row.name} | ${row.queries} | ${row.rows} | ${row.bytes} | ${row.p50.toFixed(1)} | ${row.p95.toFixed(1)} | ${row.p99.toFixed(1)} | ${row.loopLagMs.toFixed(1)} |`
    );
  }
}

/**
 * Print SQLite's own plan for every statement the grouped reads prepare, so an
 * index is only added when the plan actually uses it.
 */
function explainQueries(db: Database.Database, options: Options): void {
  const seen = new Set<string>();
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          if (!seen.has(sql)) {
            seen.add(sql);
            console.log(`\n${sql.trim().split('\n')[0]}`);
            const plan = target
              .prepare(`EXPLAIN QUERY PLAN ${sql}`)
              .all(
                ...new Array((sql.match(/\?/g) ?? []).length).fill(null)
              ) as {
              detail: string;
            }[];
            for (const row of plan) console.log(`  ${row.detail}`);
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Database.Database;

  const page = {
    windowHours: 24,
    limit: options.snapshots + 10,
    offset: 0,
  };
  querySnapshotMetas(proxy, '2026', page);
  queryElectorateHistory(proxy, 'Seat 01', '2026', page);
  queryPartyVoteHistory(proxy, '2026', page);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dir = mkdtempSync(join(tmpdir(), 'history-benchmark-'));
  const path = join(dir, 'benchmark.db');
  const page = {
    windowHours: 24,
    limit: options.snapshots + 10,
    offset: 0,
  };

  try {
    seed(path, options);
    const db = new Database(path, { readonly: true });
    if (options.explain) {
      explainQueries(db, options);
      db.close();
      return;
    }

    const results: ScenarioResult[] = [];

    results.push(
      await measure(
        'grouped · snapshots',
        db,
        (handle) => {
          const result = querySnapshotMetas(handle, '2026', page);
          return {
            rows: result.rows.length,
            bytes: Buffer.byteLength(JSON.stringify(result.rows)),
          };
        },
        options.iterations
      )
    );

    results.push(
      await measure(
        'legacy · one electorate',
        db,
        (handle) => {
          const rows = legacyElectorateHistory(handle, 'Seat 01', '2026');
          return {
            rows: rows.length,
            bytes: Buffer.byteLength(JSON.stringify(rows)),
          };
        },
        options.iterations
      )
    );

    results.push(
      await measure(
        'grouped · one electorate',
        db,
        (handle) => {
          const result = queryElectorateHistory(
            handle,
            'Seat 01',
            '2026',
            page
          );
          return {
            rows: result.rows.length,
            bytes: Buffer.byteLength(JSON.stringify(result.rows)),
          };
        },
        options.iterations
      )
    );

    results.push(
      await measure(
        'grouped · five electorates',
        db,
        (handle) => {
          let rows = 0;
          let bytes = 0;
          for (let seat = 1; seat <= 5; seat += 1) {
            const result = queryElectorateHistory(
              handle,
              `Seat ${pad(seat)}`,
              '2026',
              page
            );
            rows += result.rows.length;
            bytes += Buffer.byteLength(JSON.stringify(result.rows));
          }
          return { rows, bytes };
        },
        options.iterations
      )
    );

    results.push(
      await measure(
        'legacy · party votes',
        db,
        (handle) => {
          const rows = legacyPartyVoteHistory(handle, '2026');
          return {
            rows: rows.length,
            bytes: Buffer.byteLength(JSON.stringify(rows)),
          };
        },
        options.iterations
      )
    );

    results.push(
      await measure(
        'grouped · party votes',
        db,
        (handle) => {
          const result = queryPartyVoteHistory(handle, '2026', page);
          return {
            rows: result.rows.length,
            bytes: Buffer.byteLength(JSON.stringify(result.rows)),
          };
        },
        options.iterations
      )
    );

    db.close();

    // Retention is timed separately: it owns writes and the WAL, and is not a
    // read scenario.
    openDb(path);
    const pruneStart = performance.now();
    const pruned = pruneSnapshots(24);
    const pruneMs = performance.now() - pruneStart;
    closeDb();

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            options,
            results,
            retention: {
              deletedSnapshots: pruned.deletedSnapshots,
              stoppedEarly: pruned.stoppedEarly,
              ms: pruneMs,
            },
          },
          null,
          2
        )
      );
    } else {
      printTable(results);
      console.log(
        `\nRetention sweep: deleted ${pruned.deletedSnapshots} snapshot(s), stoppedEarly=${pruned.stoppedEarly}, ${pruneMs.toFixed(1)} ms`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
