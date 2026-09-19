import 'dotenv/config';
import type {
  ElectorateConfig,
  ElectionSource,
  PartyList,
} from '@election-night/core/types';
import { log } from './logger.js';
import { openDb, closeDb, writeResults } from './db.js';
import {
  connectWs,
  publishResults,
  publishMetrics,
  disconnectWs,
} from './ws-client.js';
import { emitSnapshotWrite } from './metrics.js';
import { cacheResults, processResults } from './results.js';
import { loadSource } from './source-loader.js';
import { scrapeCycle } from './scrape-cycle.js';
import { collectorConfig } from './config.js';
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
} = collectorConfig;

let partyListRecords: PartyList[] = [];
let source: ElectionSource;
let electorateConfigs: ElectorateConfig[] = [];

function logConfiguration(): void {
  log.info('=== Collector Configuration ===');
  log.info(`DB_PATH:          ${collectorConfig.dbPath}`);
  log.info(`SOURCE:           ${source.getName()}`);
  log.info(`ELECTION_YEAR:    ${collectorConfig.electionYear}`);
  log.info(`WS_URL:           ${collectorConfig.wsUrl}`);
  log.info(`POLL_INTERVAL_MS: ${collectorConfig.pollIntervalMs}`);
  log.info(`CONCURRENCY:      ${collectorConfig.concurrency}`);
  log.info(`FETCH_TIMEOUT_MS: ${collectorConfig.fetchTimeoutMs}`);
  log.info(`FETCH_PACING_MS:  ${collectorConfig.fetchPacingMs}`);
  log.info(`LOG_LEVEL:        ${collectorConfig.logLevel}`);
  log.info(`HEALTH_PORT:      ${collectorConfig.healthPort}`);
  log.info(`Electorates:      ${electorateConfigs.length}`);
  if (collectorConfig.webhookUrl)
    log.info(`WEBHOOK_URL:      ${collectorConfig.webhookUrl}`);
  if (collectorConfig.electionSourcePath)
    log.info(`ELECTION_SOURCE:  ${collectorConfig.electionSourcePath}`);
  log.info('=============================');
}

async function runOnce(): Promise<void> {
  health.cycleCount += 1;
  health.lastCycleStartedAt = Date.now();
  health.lastError = null;

  try {
    const payload = await scrapeCycle({
      source,
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

async function loopRun(): Promise<void> {
  try {
    await runOnce();
  } catch (err) {
    log.error('Election night cycle failed', err);
    health.lastCycleOk = false;
    health.lastError = err instanceof Error ? err.message : String(err);
  }
  setTimeout(loopRun, POLL_INTERVAL_MS);
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason);
});

async function main(): Promise<void> {
  try {
    ({
      source,
      configs: electorateConfigs,
      partyListRecords,
    } = await loadSource());
  } catch (err) {
    log.error('Failed to load election source', err);
    process.exit(1);
  }

  logConfiguration();

  try {
    openDb(dbPath);
  } catch (err) {
    log.error('Failed to open database', err);
    process.exit(1);
  }

  connectWs(WS_URL);

  try {
    startHealthServer(
      collectorConfig.healthPort,
      createHistoryHandler({
        dbPath: collectorConfig.dbPath,
        electionYear: collectorConfig.electionYear,
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
