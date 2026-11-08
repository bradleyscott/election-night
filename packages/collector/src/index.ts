import 'dotenv/config';
import type {
  ElectorateConfig,
  ElectionSource,
  PartyList,
} from '@election-night/core/types';
import { log } from './logger.js';
import { DbWorkerClient } from './db-worker-client.js';
import {
  connectWs,
  publishResults,
  publishMetrics,
  disconnectWs,
} from './ws-client.js';
import {
  emitSnapshotWrite,
  recordDiskUsage,
  sampleDiskUsage,
} from './metrics.js';
import { describeSweep, effectiveKeepHours, shouldSweep } from './retention.js';
import { nextPollDelay } from './poll-delay.js';
import { cacheResults, cacheCycle, processResults } from './results.js';
import { loadSource } from './source-loader.js';
import { resolveFeedBaseUrl } from '@election-night/core/sources';
import { scrapeCycle, type ScrapeCycleResult } from './scrape-cycle.js';
import { collectorConfig } from './config.js';
import { createResultsService } from './historical-results.js';
import { startHealthServer, health } from './health.js';
import { createHistoryHandler, closeHistoryDb } from './history-server.js';
import { VotingPlaceStatusService } from './voting-place-status.js';
import { loadNotionalBaseline } from './notional-baseline.js';
import { chanceLookupFor } from '@election-night/core/notional-baseline';
import { COUNT_SUMMARY_VERSION } from '@election-night/core/count-summary';

if (process.argv[2] === 'clear') {
  const { runClear } = await import('./clear.js');
  await runClear();
  process.exit(0);
}

const {
  pollIntervalMs: POLL_INTERVAL_MS,
  wsUrl: WS_URL,
  concurrency: CONCURRENCY,
  dbPath,
  retentionHours: RETENTION_HOURS,
  retentionSweepMs: RETENTION_SWEEP_MS,
} = collectorConfig;

/** When the last retention sweep ran; null until the first one. */
let lastSweepAt: number | null = null;

/**
 * The thread that owns SQLite. Failures are fatal on purpose: without the
 * writer the collector can still scrape and publish over Socket.io, which is
 * exactly the "looks alive, records nothing" state the watchdog exists to
 * prevent. Exiting lets the entrypoint restart the machine.
 */
const dbWorker = new DbWorkerClient({
  onFatal: (err) => {
    health.lastError = `database worker failed: ${err.message}`;
    log.error(
      'Database worker failed; exiting so the supervisor restarts the collector',
      err
    );
    process.exit(1);
  },
});

/**
 * `Last-Modified` per electorate, from the last cycle that observed it.
 *
 * Kept in memory rather than on the volume: a restart costs exactly one
 * unconditional cycle, and a persisted stamp that outlived its cache could only
 * ever produce 304s for data we no longer hold.
 */
let feedStamps = new Map<string, string>();

/**
 * Digest of the last payload whose publish *completed*: written, cached,
 * broadcast. A cycle whose signature matches it has nothing to say, so it writes
 * no snapshot and broadcasts nothing.
 *
 * Set only after every step of the publish path has returned, which is what
 * makes a failed write self-healing: the signature stays put, so the next cycle
 * (even one where every seat 304s) still looks different and tries again.
 */
let lastPublishedSignature: string | null = null;
/**
 * A counted outcome whose commit failed. Kept in memory so the next poll
 * retries the same body instead of relying on the feed to republish it.
 */
let pendingOutcome: ScrapeCycleResult | null = null;

let partyListRecords: PartyList[] = [];
let source: ElectionSource | null = null;
let electorateConfigs: ElectorateConfig[] = [];

const resultsService = createResultsService();

/**
 * The previous cycle's votes on this cycle's boundaries, read once.
 *
 * The webhook has to speak the same language as the feed, and the feed calls a
 * seat on a chance of winning — which needs a prior. Without a baseline for the
 * cycle the collector still runs; it just publishes counts, never predictions.
 */
const notionalBaseline = loadNotionalBaseline(collectorConfig.electionYear);

/**
 * Per-place count status, served on demand for the seat a visitor opened.
 * Fetches from the same feed the scrape loop reads, but not on the loop: the
 * register is 632 KB and a seat's places ~70 files, so it answers only what is
 * asked for and caches each seat briefly.
 */
const votingPlaces = new VotingPlaceStatusService({
  baseUrl: resolveFeedBaseUrl({
    year: collectorConfig.electionYear,
    baseUrl: collectorConfig.xmlFeedBaseUrl,
  }),
  electionYear: collectorConfig.electionYear,
  timeoutMs: collectorConfig.fetchTimeoutMs,
  onLog: (message, error) => log.warn(message, error ?? ''),
});

health.electionYear = collectorConfig.electionYear;

function logConfiguration(): void {
  log.info('=== Collector Configuration ===');
  log.info(`DB_PATH:          ${collectorConfig.dbPath}`);
  log.info(`SOURCE:           ${source?.getName() ?? 'not loaded'}`);
  log.info(`ELECTION_YEAR:    ${collectorConfig.electionYear}`);
  log.info(`WS_URL:           ${collectorConfig.wsUrl}`);
  log.info(`POLL_INTERVAL_MS: ${collectorConfig.pollIntervalMs}`);
  log.info(
    `RETENTION_HOURS:  ${RETENTION_HOURS > 0 ? `${RETENTION_HOURS} (prune older snapshots on startup and every ${Math.round(RETENTION_SWEEP_MS / 1000)}s)` : 'disabled (keep every snapshot)'}`
  );
  log.info(
    `CONDITIONAL POLL: ${
      typeof source?.fetchResultsConditional === 'function'
        ? 'yes (If-Modified-Since; a quiet seat costs headers, not a body)'
        : 'no — this source cannot answer 304, so every poll downloads every seat'
    }`
  );
  log.info(`CONCURRENCY:      ${collectorConfig.concurrency}`);
  log.info(`FETCH_TIMEOUT_MS: ${collectorConfig.fetchTimeoutMs}`);
  log.info(`FETCH_PACING_MS:  ${collectorConfig.fetchPacingMs}`);
  log.info(`LOG_LEVEL:        ${collectorConfig.logLevel}`);
  log.info(`HEALTH_PORT:      ${collectorConfig.healthPort}`);
  log.info(`Electorates:      ${electorateConfigs.length}`);
  log.info(
    `Prior cycles:     ${resultsService.getPriorYears().join(', ') || 'none'}`
  );
  if (collectorConfig.priorElectionYear)
    log.info(`PRIOR_ELECTION_YEAR: ${collectorConfig.priorElectionYear}`);
  if (collectorConfig.webhookUrl)
    log.info(`WEBHOOK_URL:      ${collectorConfig.webhookUrl}`);
  if (collectorConfig.electionSourcePath)
    log.info(`ELECTION_SOURCE:  ${collectorConfig.electionSourcePath}`);
  log.info('=============================');
}

/**
 * Load the reference data a scrape needs (candidates, parties, electorates).
 *
 * A failure here must never be fatal. The feed for the next cycle 404s until
 * results are published, and any upstream blip on election night fails the same
 * way — and the entrypoint treats the collector exiting as a reason to tear the
 * whole machine down, so exiting here would take the dashboard with it and
 * crash-loop the app. Returning null skips this cycle; the next poll retries.
 */
async function ensureSource(): Promise<ElectionSource | null> {
  if (source) return source;

  try {
    const loaded = await loadSource();
    source = loaded.source;
    electorateConfigs = loaded.configs;
    partyListRecords = loaded.partyListRecords;
    health.source = source.getName();
    resultsService.setCurrentElectorates(
      electorateConfigs.map((c) => c.electorateName)
    );
    logConfiguration();
    return source;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    health.lastError = `election source unavailable: ${reason}`;
    log.warn(
      `Election source unavailable for ${collectorConfig.electionYear} (${reason}). ` +
        `The feed may not be published yet; retrying in ${Math.round(POLL_INTERVAL_MS / 1000)}s`
    );
    return null;
  }
}

/**
 * Write, diff, cache and publish one counted outcome.
 *
 * The feed's `Last-Modified` stamps are advanced only here, after every step
 * has returned. Advancing them when the body arrived would pair a new validator
 * with a body that was never committed: the next poll would ask
 * `If-Modified-Since: <new>`, get 304, and reuse the old cached body, losing the
 * new count until the feed happened to republish it. The caller also holds the
 * outcome itself, so a source that answers 304-only after the failed attempt
 * still gets the pending body committed.
 */
async function commitCounted(outcome: ScrapeCycleResult): Promise<void> {
  const payload = outcome.payload;

  // One lookup for the whole payload: the swing behind it depends on every
  // seat at once, so the snapshot write and the webhook diff must share it or
  // the two could describe the same seat differently.
  const liveChanceLookup = chanceLookupFor(
    notionalBaseline,
    payload.electorateResults,
    collectorConfig.electionYear
  );

  const writeStartedAt = performance.now();
  try {
    await dbWorker.write({
      results: payload.electorateResults,
      partyVote: payload.partyVote,
      partyLists: payload.partyLists,
      electionYear: collectorConfig.electionYear,
      publicationKey: outcome.publicationKey,
      source: health.source,
      observedAt: new Date(
        health.lastCycleStartedAt ?? Date.now()
      ).toISOString(),
      phase: 'counting',
      coverage: {
        seats: payload.electorateResults.length,
        counts: outcome.counts,
      },
      modelVersion: COUNT_SUMMARY_VERSION,
      configVersion: collectorConfig.electionYear,
      // The worker cannot receive the lookup function; compute the same
      // progress here and send plain numbers.
      progressByElectorate: Object.fromEntries(
        payload.electorateResults.map((r) => {
          const chance = liveChanceLookup?.(r);
          return [
            r.electorateName,
            chance?.state === 'counting'
              ? Math.min(1, chance.progress)
              : r.votePercentageCounted,
          ];
        })
      ),
    });
    publishMetrics(
      emitSnapshotWrite((performance.now() - writeStartedAt) / 1000, 'success')
    );
  } catch (err) {
    publishMetrics(
      emitSnapshotWrite((performance.now() - writeStartedAt) / 1000, 'error')
    );
    throw err;
  }

  await processResults(payload.electorateResults, liveChanceLookup);
  cacheResults(payload.electorateResults);
  health.cacheYear = cacheCycle();
  resultsService.setLiveResults(payload);

  // Publish with the revision the commit just produced. If the read fails, the
  // payload is still published; the browser's bootstrap compares revisions and
  // its 30s poll catches up.
  const committed = await dbWorker
    .latest(collectorConfig.electionYear)
    .catch(() => null);
  publishResults(payload, committed?.revision ?? null);

  feedStamps = outcome.stamps;
  lastPublishedSignature = outcome.signature;
  health.lastCycleFinishedAt = Date.now();
  health.lastCycleOk = true;
  health.lastError = null;
  health.lastVotesCounted = payload.electorateResults.reduce(
    (sum, r) => sum + (r.votesCounted || 0),
    0
  );
}

async function runOnce(current: ElectionSource): Promise<void> {
  health.cycleCount += 1;
  health.lastCycleStartedAt = Date.now();
  // `lastError` is cleared only by a cycle that finished its work, below, not
  // here: clearing it up front left `/health` reporting "ok" between the start
  // of a retry and the step that failed last time, which reads as recovery.
  // Sample the volume before this cycle writes to it, so a full disk is
  // visible in the metrics ahead of the write that fails because of it.
  recordDiskUsage(dbPath);

  try {
    // A failed counted cycle holds its outcome here. Retrying it before the
    // next scrape means a source that has already moved past the new stamp
    // (and would answer 304) cannot strand the body that never committed.
    if (pendingOutcome) {
      try {
        await commitCounted(pendingOutcome);
        pendingOutcome = null;
        log.info('Committed the result held from the previous failed cycle');
      } catch (err) {
        health.lastCycleOk = false;
        health.lastError = err instanceof Error ? err.message : String(err);
        log.error(
          'Retrying the held result failed; keeping it for the next poll',
          err
        );
        return;
      }
    }

    const outcome = await scrapeCycle({
      source: current,
      configs: electorateConfigs,
      partyListRecords,
      concurrency: CONCURRENCY,
      previousStamps: feedStamps,
    });

    const payload = outcome.payload;
    const votesCounted = payload.electorateResults.reduce(
      (sum, r) => sum + (r.votesCounted || 0),
      0
    );

    // The payload is compared against the last one whose publish *completed*,
    // not against what the feed did: a seat republished with identical content
    // is not a change, a seat whose body moved without a moving `Last-Modified`
    // still is, and a failed write leaves the signature unset so the next cycle
    // retries it. Writing an identical payload would add a snapshot row and a
    // socket broadcast per poll — 1,440 a day at the one-minute cadence — for
    // no new information, which is what makes a fast poll loop affordable.
    if (outcome.signature === lastPublishedSignature) {
      // Nothing new to write, but the feed did validate these stamps; they
      // describe the body that is already committed.
      feedStamps = outcome.stamps;
      health.lastCycleFinishedAt = Date.now();
      health.lastCycleOk = true;
      health.lastError = null;
      health.lastVotesCounted = votesCounted;
      log.info(
        `Feed unchanged (fresh ${outcome.counts.fresh}, unchanged ${outcome.counts.unchanged}, cached ${outcome.counts.cached}, failed ${outcome.counts.failed} of ${electorateConfigs.length}); nothing written or published`
      );
      return;
    }

    // A scrape where nothing has been counted yet is the ballot, not a result.
    // The feed publishes every electorate with zero votes ahead of election
    // night, so recording it would fill the timeline with flat zero snapshots
    // and — worse — become the diff baseline that the first real count is
    // measured against, turning every seat into a spurious "leader change" at
    // 7pm. Publish the payload and refresh the results cache (the dashboard
    // preloads it, and a stale cache from an earlier shape must not outlive the
    // first good scrape) but keep the zero count out of history and the feed.
    if (votesCounted === 0) {
      // The zero ballot is durable latest state, not count history: a restart
      // with the feed down must still know the parties, lists and seats.
      const zeroRevision = await dbWorker.writeLatest({
        results: payload.electorateResults,
        partyVote: payload.partyVote,
        partyLists: payload.partyLists,
        electionYear: collectorConfig.electionYear,
        publicationKey: outcome.publicationKey,
        source: health.source,
        observedAt: new Date(
          health.lastCycleStartedAt ?? Date.now()
        ).toISOString(),
        phase: 'unknown',
        coverage: {
          seats: payload.electorateResults.length,
          counts: outcome.counts,
        },
        modelVersion: COUNT_SUMMARY_VERSION,
        configVersion: collectorConfig.electionYear,
      });
      cacheResults(payload.electorateResults);
      health.cacheYear = cacheCycle();
      resultsService.setLiveResults(payload);
      publishResults(payload, zeroRevision);
      feedStamps = outcome.stamps;
      lastPublishedSignature = outcome.signature;
      health.lastCycleFinishedAt = Date.now();
      health.lastCycleOk = true;
      health.lastError = null;
      health.lastVotesCounted = 0;
      log.info(
        'No votes counted yet — holding the results timeline until the first count arrives'
      );
      return;
    }

    try {
      await commitCounted(outcome);
    } catch (err) {
      pendingOutcome = outcome;
      throw err;
    }
  } finally {
    log.info('Processing of results completed!');
  }
}

/**
 * Prune expired snapshots and hand the freed pages back to the filesystem.
 *
 * Runs between cycles (never during a scrape, so it never competes for the
 * database with a write) and is bounded work: the window only moves forward,
 * so a sweep deletes at most one sweep interval's worth of snapshots.
 */
async function retentionSweep(now = Date.now()): Promise<void> {
  if (RETENTION_HOURS <= 0) return;

  const disk = sampleDiskUsage(dbPath);
  const keepHours = effectiveKeepHours(RETENTION_HOURS, disk);
  const interval = RETENTION_SWEEP_MS;

  // A volume below the threshold sweeps immediately, regardless of schedule.
  if (
    keepHours >= RETENTION_HOURS &&
    !shouldSweep(lastSweepAt, now, interval)
  ) {
    return;
  }
  lastSweepAt = now;
  await pruneAndCompact(keepHours);
}

/**
 * One prune-and-compact pass, shared by the startup prune and every sweep.
 *
 * Neither caller may fail: an unprunable database (a full volume) still needs
 * the collector to run and report why it cannot write, so a failure is logged
 * and the process continues.
 */
async function pruneAndCompact(keepHours: number): Promise<void> {
  try {
    const { deletedSnapshots } = await dbWorker.prune(keepHours);
    const freedPages = await dbWorker.compact();
    if (deletedSnapshots > 0 || freedPages > 0) {
      log.info(
        describeSweep({
          deletedSnapshots,
          freedPages,
          keepHours,
          underPressure: keepHours < RETENTION_HOURS,
        })
      );
    }
  } catch (err) {
    log.error('Retention sweep failed', err);
  }
}

async function loopRun(): Promise<void> {
  try {
    const current = await ensureSource();
    if (current) {
      await runOnce(current);
    } else {
      // Sample the volume on every poll even while the feed is missing, so the
      // disk metrics (and with them the heartbeat Fly records from the socket)
      // keep flowing and "up but with nothing to report" is distinguishable
      // from "collector is gone".
      recordDiskUsage(dbPath);
    }
  } catch (err) {
    log.error('Election night cycle failed', err);
    health.lastCycleOk = false;
    health.lastError = err instanceof Error ? err.message : String(err);
  }
  // Retry any archived cycle that failed earlier, so a blip at startup does
  // not leave prior results unavailable until the next deploy. Cached cycles
  // return immediately, so this is a no-op once they are in.
  void resultsService.warmPriorYears().catch((err) => {
    log.warn('Prior-year warm-up failed', err);
  });
  await retentionSweep();
  // ±20% on the tick (capped at five minutes each way), so a machine hitting the
  // feed at exactly POLL_INTERVAL_MS forever is not a metronome in front of the
  // feed's bot scoring — see `poll-delay.ts` for why the cap matters at a daily
  // cadence.
  setTimeout(loopRun, nextPollDelay(POLL_INTERVAL_MS));
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason);
});

async function main(): Promise<void> {
  // Deliberately not fatal: `ensureSource` reports why and the loop retries.
  await ensureSource();

  try {
    await dbWorker.open(dbPath);
  } catch (err) {
    log.error('Failed to open database', err);
    process.exit(1);
  }

  // Retention: keep the volume bounded before the first write of this process.
  // A full sweep, not `retentionSweep()`: the schedule is irrelevant at boot,
  // and the configured window applies even if the volume is under pressure.
  await pruneAndCompact(RETENTION_HOURS);
  lastSweepAt = Date.now();

  connectWs(WS_URL);

  try {
    startHealthServer(
      collectorConfig.healthPort,
      createHistoryHandler({
        dbPath: collectorConfig.dbPath,
        electionYear: collectorConfig.electionYear,
        resultsService,
        votingPlaces,
        reader: dbWorker.historyReader(),
        windowHours: collectorConfig.historyWindowHours,
        maxSnapshots: collectorConfig.historyMaxSnapshots,
      })
    );
  } catch (err) {
    log.error('Failed to start health server', err);
    process.exit(1);
  }

  loopRun().catch((err) => {
    log.error('Fatal error in scrape loop', err);
    process.exit(1);
  });
}

main();

// One shutdown path for both signals: disconnect first so the dashboard stops
// waiting on us, then stop the SQLite worker and close any direct read handle.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    disconnectWs();
    void dbWorker.close().finally(() => {
      closeHistoryDb();
      process.exit(0);
    });
  });
}
