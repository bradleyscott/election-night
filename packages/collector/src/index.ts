import 'dotenv/config';
import type {
  ElectorateConfig,
  ElectionSource,
  PartyList,
} from '@election-night/core/types';
import { log } from './logger.js';
import {
  openDb,
  closeDb,
  writeResults,
  pruneSnapshots,
  compactDatabase,
} from './db.js';
import {
  connectWs,
  publishResults,
  publishMetrics,
  disconnectWs,
} from './ws-client.js';
import { emitSnapshotWrite, recordDiskUsage } from './metrics.js';
import {
  describeSweep,
  effectiveKeepHours,
  sampleDisk,
  shouldSweep,
} from './retention.js';
import { cacheResults, processResults } from './results.js';
import { loadSource } from './source-loader.js';
import { scrapeCycle } from './scrape-cycle.js';
import { collectorConfig } from './config.js';
import { createResultsService } from './historical-results.js';
import { startHealthServer, health } from './health.js';
import { createHistoryHandler, closeHistoryDb } from './history-server.js';

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

let partyListRecords: PartyList[] = [];
let source: ElectionSource | null = null;
let electorateConfigs: ElectorateConfig[] = [];

const resultsService = createResultsService();

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

async function runOnce(current: ElectionSource): Promise<void> {
  health.cycleCount += 1;
  health.lastCycleStartedAt = Date.now();
  health.lastError = null;
  // Sample the volume before this cycle writes to it, so a full disk is
  // visible in the metrics ahead of the write that fails because of it.
  recordDiskUsage(dbPath);

  try {
    const payload = await scrapeCycle({
      source: current,
      configs: electorateConfigs,
      partyListRecords,
      concurrency: CONCURRENCY,
    });

    const writeStartedAt = performance.now();
    try {
      writeResults(
        payload.electorateResults,
        payload.partyVote,
        payload.partyLists,
        collectorConfig.electionYear
      );
      publishMetrics(
        emitSnapshotWrite(
          (performance.now() - writeStartedAt) / 1000,
          'success'
        )
      );
    } catch (err) {
      publishMetrics(
        emitSnapshotWrite((performance.now() - writeStartedAt) / 1000, 'error')
      );
      throw err;
    }
    await processResults(payload.electorateResults);
    cacheResults(payload.electorateResults);
    resultsService.setLiveResults(payload);
    publishResults(payload);
    health.lastCycleFinishedAt = Date.now();
    health.lastCycleOk = true;
    health.lastVotesCounted = payload.electorateResults.reduce(
      (sum, r) => sum + (r.votesCounted || 0),
      0
    );
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
function retentionSweep(now = Date.now()): void {
  if (RETENTION_HOURS <= 0) return;

  const disk = sampleDisk(dbPath);
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

  try {
    const { deletedSnapshots } = pruneSnapshots(keepHours);
    const freedPages = compactDatabase();
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
  retentionSweep();
  setTimeout(loopRun, POLL_INTERVAL_MS);
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason);
});

async function main(): Promise<void> {
  // Deliberately not fatal: `ensureSource` reports why and the loop retries.
  await ensureSource();

  try {
    openDb(dbPath);
  } catch (err) {
    log.error('Failed to open database', err);
    process.exit(1);
  }

  // Retention: keep the volume bounded before the first write of this process.
  // Failure is not fatal — an unprunable database (a full volume) still needs
  // the collector to run and report why it cannot write.
  try {
    const pruned = pruneSnapshots(RETENTION_HOURS);
    const freedPages = compactDatabase();
    lastSweepAt = Date.now();
    if (pruned.deletedSnapshots > 0 || freedPages > 0) {
      log.info(
        describeSweep({
          deletedSnapshots: pruned.deletedSnapshots,
          freedPages,
          keepHours: RETENTION_HOURS,
          underPressure: false,
        })
      );
    }
  } catch (err) {
    log.error('Retention prune failed', err);
  }

  connectWs(WS_URL);

  try {
    startHealthServer(
      collectorConfig.healthPort,
      createHistoryHandler({
        dbPath: collectorConfig.dbPath,
        electionYear: collectorConfig.electionYear,
        resultsService,
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

process.on('SIGINT', () => {
  disconnectWs();
  closeDb();
  closeHistoryDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectWs();
  closeDb();
  closeHistoryDb();
  process.exit(0);
});
