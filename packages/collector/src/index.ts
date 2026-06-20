import 'dotenv/config';
import { fileURLToPath } from 'url';
import { launch } from 'cloakbrowser/puppeteer';
import { log } from './logger.js';
import { openDb, closeDb, writeResults } from './db.js';
import {
  connectWs,
  publishResults,
  disconnectWs,
} from './ws-client.js';
import { cacheResults, processResults } from './results.js';
import { loadCsvData } from './csv-data.js';
import { loadSource } from './source-loader.js';
import { scrapeCycle } from './scrape-cycle.js';
import { collectorConfig } from './config.js';

export async function main(argv: string[] = process.argv): Promise<() => void> {
  if (argv[2] === 'discover') {
    const { runDiscover } = await import('./discover.js');
    await runDiscover(argv.slice(3));
    process.exit(0);
  }

  if (argv[2] === 'clear') {
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

  const { candidateRecords, partyListRecords, electorateNames, partyMap } =
    loadCsvData();

  const { source, configs: electorateConfigs } = await loadSource(
    electorateNames
  );

  log.info('=== Scraper Configuration ===');
  log.info(`DB_PATH:          ${collectorConfig.dbPath}`);
  log.info(
    `BASE_RESULTS_URL: ${collectorConfig.baseResultsUrl || 'https://electionresults.govt.nz/electionresults_2023'}`
  );
  log.info(`WS_URL:           ${collectorConfig.wsUrl}`);
  log.info(`POLL_INTERVAL_MS: ${collectorConfig.pollIntervalMs}`);
  log.info(`CONCURRENCY:      ${collectorConfig.concurrency}`);
  log.info(`NAV_TIMEOUT_MS:   ${collectorConfig.navigationTimeoutMs}`);
  log.info(`LOG_LEVEL:        ${collectorConfig.logLevel}`);
  if (collectorConfig.webhookUrl)
    log.info(`WEBHOOK_URL:      ${collectorConfig.webhookUrl}`);
  if (collectorConfig.electionSourcePath)
    log.info(`ELECTION_SOURCE:   ${collectorConfig.electionSourcePath}`);
  log.info(`Electorates:      ${electorateConfigs.length}`);
  log.info('=============================');

  async function runOnce(): Promise<void> {
    const browser = await launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    try {
      const payload = await scrapeCycle({
        browser,
        source,
        configs: electorateConfigs,
        candidateRecords,
        partyMap,
        partyListRecords,
        concurrency: CONCURRENCY,
      });

      await processResults(payload.electorateResults);
      cacheResults(payload.electorateResults);
      writeResults(
        payload.electorateResults,
        payload.partyVote,
        payload.partyLists
      );
      publishResults(payload);
    } finally {
      await browser.close().catch((err) =>
        log.error('Error closing browser', err)
      );
    }

    log.info('Processing of results completed!');
  }

  async function loopRun(): Promise<void> {
    try {
      await runOnce();
    } catch (err) {
      log.error('Election night cycle failed', err);
    }
    setTimeout(loopRun, POLL_INTERVAL_MS);
  }

  process.on('unhandledRejection', (reason) => {
    if (
      reason instanceof Error &&
      (reason.message.includes('TargetCloseError') ||
        reason.message.includes('Protocol error'))
    ) {
      return;
    }
    log.error('Unhandled rejection', reason);
  });

  openDb(dbPath);
  connectWs(WS_URL);
  loopRun().catch((err) => log.error('Fatal error in loop', err));

  function shutdown() {
    disconnectWs();
    closeDb();
  }

  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  return shutdown;
}

// Only start the collector automatically when this file is the entrypoint.
// This keeps the module side-effect free so it can be imported in tests.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error('Collector failed to start:', err);
    process.exit(1);
  });
}
