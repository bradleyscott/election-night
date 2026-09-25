import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql, eq } from 'drizzle-orm';
import * as schema from './db/schema.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  VotingResults,
  WithSeats,
  PartyList,
  WithAdjustedRank,
} from '@election-night/core/types';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Results = ElectorateResults & WithLeaders & WithMarginOfError;
type PartyVoteSummary = VotingResults & WithSeats;
type PartyListEntry = PartyList & WithAdjustedRank;

let sqliteDb: Database.Database;
let drizzleDb: ReturnType<typeof drizzle<typeof schema>>;

/** `PRAGMA auto_vacuum` value for incremental auto-vacuum (SQLite's "2"). */
const INCREMENTAL_AUTO_VACUUM = 2;

export function openDb(dbPath: string): void {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  sqliteDb = new Database(dbPath);
  if (dbPath !== ':memory:') {
    sqliteDb.pragma('journal_mode = WAL');
    // Ask for incremental auto-vacuum before the migrations create anything:
    // on an empty database the setting takes effect immediately, so the
    // storage can be reclaimed later with `compactDatabase()` without a
    // full-file rewrite. See enableIncrementalVacuum() for existing files.
    sqliteDb.pragma('auto_vacuum = INCREMENTAL');
  }
  drizzleDb = drizzle(sqliteDb, { schema });
  migrate(drizzleDb, {
    migrationsFolder: resolve(__dirname, '../drizzle'),
  });
  if (dbPath !== ':memory:') enableIncrementalVacuum();
}

export function closeDb() {
  if (sqliteDb) sqliteDb.close();
}

export function writeResults(
  results: Results[],
  partyVote: PartyVoteSummary[],
  partyLists: PartyListEntry[],
  /**
   * Election cycle this scrape belongs to. Stored on the snapshot so
   * `/history/*` can scope itself to one cycle instead of blending whatever
   * cycles happen to share the DB (the Fly deployment keeps it on a volume).
   */
  electionYear: string
) {
  log.info('Writing results to DB...');

  drizzleDb.transaction((tx) => {
    const { id: scrapeId } = tx
      .insert(schema.scrapeSnapshots)
      .values({ electionYear })
      .returning({ id: schema.scrapeSnapshots.id })
      .get();

    for (const r of results) {
      for (const cv of r.candidateVotes) {
        tx.insert(schema.electorateResults)
          .values({
            scrapeId,
            electorate: r.electorateName,
            candidate: cv.candidate,
            party: cv.party ?? '',
            votes: cv.votes,
            isPredicted:
              r.leaders.predictionStatus === 'projected' &&
              r.leaders.leadingCandidate === cv.candidate
                ? 1
                : 0,
          })
          .run();
      }

      tx.insert(schema.electorateSummary)
        .values({
          scrapeId,
          electorate: r.electorateName,
          votesCounted: r.votesCounted,
          estimatedTotalVotes:
            r.votePercentageCounted > 0 &&
            Number.isFinite(r.votePercentageCounted)
              ? r.votesCounted / r.votePercentageCounted
              : 0,
          votePctCounted: r.votePercentageCounted,
          leadingCandidate: r.leaders.leadingCandidate,
          leadingParty: r.leaders.leadingCandidateParty,
          predictedWinner:
            r.leaders.predictionStatus === 'projected'
              ? 3
              : r.leaders.predictionStatus === 'likely'
                ? 2
                : r.leaders.predictionStatus === 'leaning'
                  ? 1
                  : 0,
          margin: r.leaders.margin,
          marginPct: r.leaders.marginPercent,
          secondCandidate: r.leaders.secondCandidate,
          secondParty: r.leaders.secondCandidateParty,
          marginOfError: Number.isFinite(r.marginOfError)
            ? r.marginOfError
            : null,
        })
        .run();

      const seenPartyVotes = new Set<string>();
      for (const pv of r.partyVotes) {
        const key = `${r.electorateName}:${pv.candidate}`;
        if (seenPartyVotes.has(key)) continue;
        seenPartyVotes.add(key);
        tx.insert(schema.partyVoteResults)
          .values({
            scrapeId,
            electorate: r.electorateName,
            party: pv.candidate,
            votes: pv.votes,
          })
          .run();
      }
    }

    for (const pv of partyVote) {
      tx.insert(schema.partyVoteSummary)
        .values({
          scrapeId,
          party: pv.candidate,
          votes: pv.votes,
          seats: pv.seats,
          electorateSeats: pv.electorateSeats,
          listSeats: pv.listSeats,
        })
        .run();
    }

    for (const pl of partyLists) {
      tx.insert(schema.partyLists)
        .values({
          scrapeId,
          party: pl.party,
          candidate: pl.candidate,
          listRank: pl.listRank,
          adjustedRank: pl.adjustedRank,
          distanceFromCut: pl.distanceFromCut,
        })
        .run();
    }

    tx.update(schema.scrapeSnapshots)
      .set({ completedAt: sql`(datetime('now'))` })
      .where(eq(schema.scrapeSnapshots.id, scrapeId))
      .run();

    log.info(`DB write complete (scrape #${scrapeId})`);
  });
}

// ---- Retention -----------------------------------------------------------

/** Child tables keyed by `scrape_id`, deleted before the snapshot row itself. */
const SNAPSHOT_CHILD_TABLES = [
  'electorate_results',
  'electorate_summary',
  'party_vote_results',
  'party_vote_summary',
  'party_lists',
] as const;

/**
 * Snapshots deleted per transaction. Small on purpose: the WAL has to hold the
 * whole batch, and the interesting case is a volume that is nearly full, where
 * one large `DELETE` fails with `SQLITE_FULL` and frees nothing. Batching with
 * a checkpoint between keeps the WAL bounded so pruning can always make
 * progress. There is no auto-vacuum, so freed pages go to the freelist and are
 * reused by the next scrape rather than returned to the filesystem.
 */
const PRUNE_BATCH = 100;

export type PruneResult = {
  deletedSnapshots: number;
  /** True when a batch hit an error (e.g. a full volume) and pruning stopped. */
  stoppedEarly: boolean;
};

/**
 * Delete snapshots (and their child rows) older than `keepHours`.
 *
 * The newest snapshot is always kept, so a deployment that has lain idle for
 * longer than the window still has something to serve. `keepHours <= 0`
 * disables pruning entirely.
 */
export function pruneSnapshots(
  keepHours: number,
  batchSize: number = PRUNE_BATCH
): PruneResult {
  if (!Number.isFinite(keepHours) || keepHours <= 0) {
    return { deletedSnapshots: 0, stoppedEarly: false };
  }

  const cutoff = `-${Math.floor(keepHours)} hours`;
  const selectBatch = sqliteDb.prepare(
    `select id from scrape_snapshots
      where started_at < datetime('now', ?)
        and id < (select max(id) from scrape_snapshots)
      order by id
      limit ?`
  );
  const deleteChildren = SNAPSHOT_CHILD_TABLES.map((table) =>
    sqliteDb.prepare(`delete from ${table} where scrape_id in (select value from json_each(?))`)
  );
  const deleteSnapshots = sqliteDb.prepare(
    'delete from scrape_snapshots where id in (select value from json_each(?))'
  );

  const deleteBatch = sqliteDb.transaction((ids: string) => {
    for (const del of deleteChildren) del.run(ids);
    deleteSnapshots.run(ids);
  });

  let deletedSnapshots = 0;
  for (;;) {
    const ids = (selectBatch.all(cutoff, batchSize) as { id: number }[]).map(
      (row) => row.id
    );
    if (ids.length === 0) return { deletedSnapshots, stoppedEarly: false };

    try {
      deleteBatch(JSON.stringify(ids));
    } catch (err) {
      log.error(`Retention: could not prune ${ids.length} snapshot(s)`, err);
      return { deletedSnapshots, stoppedEarly: true };
    }
    deletedSnapshots += ids.length;

    try {
      sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      // Busy (another connection is reading); the WAL will be checkpointed
      // automatically later. Not a reason to abandon pruning.
      log.debug('Retention: WAL checkpoint skipped', err);
    }
  }
}

/**
 * Turn on incremental auto-vacuum, which is what makes `compactDatabase()`
 * able to hand pages back to the filesystem.
 *
 * A database created by `openDb` already has the setting. A database created
 * before this existed carries `auto_vacuum = NONE` in its header, and SQLite
 * only adopts the new mode after a `VACUUM` — which rewrites the whole file and
 * therefore needs free space, so on a nearly-full volume this fails and is
 * logged rather than thrown: the collector must still start and report why it
 * cannot write.
 */
export function enableIncrementalVacuum(): boolean {
  if (sqliteDb.pragma('auto_vacuum', { simple: true }) === INCREMENTAL_AUTO_VACUUM) {
    return true;
  }

  sqliteDb.pragma('auto_vacuum = INCREMENTAL');
  const tables = (
    sqliteDb
      .prepare("select count(*) c from sqlite_master where type = 'table'")
      .get() as { c: number }
  ).c;

  if (tables > 0) {
    try {
      sqliteDb.exec('VACUUM');
    } catch (err) {
      log.warn(
        'Could not enable incremental auto-vacuum (VACUUM failed); pruning will recycle pages but the file will not shrink',
        err
      );
      return false;
    }
  }

  const mode = sqliteDb.pragma('auto_vacuum', { simple: true });
  if (mode !== INCREMENTAL_AUTO_VACUUM) {
    log.warn(`Incremental auto-vacuum not enabled (auto_vacuum = ${mode})`);
    return false;
  }
  return true;
}

/**
 * Return up to `maxPages` free pages at the end of the file to the filesystem,
 * then checkpoint the WAL so the on-disk size is visible immediately.
 *
 * Incremental auto-vacuum can only truncate free pages that sit *after* the
 * last live page — interior holes are left for new rows to reuse — so this can
 * legitimately free nothing even with a large freelist. Returns the number of
 * pages (of `page_size` bytes) actually returned.
 */
export function compactDatabase(maxPages = 4096): number {
  if (sqliteDb.pragma('auto_vacuum', { simple: true }) !== INCREMENTAL_AUTO_VACUUM) {
    return 0;
  }
  const before = sqliteDb.pragma('freelist_count', { simple: true }) as number;
  if (before === 0) return 0;

  sqliteDb.pragma(`incremental_vacuum(${maxPages})`);

  const after = sqliteDb.pragma('freelist_count', { simple: true }) as number;
  if (after < before) {
    try {
      sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      log.debug('Compaction: WAL checkpoint skipped', err);
    }
  }
  return before - after;
}
