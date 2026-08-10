import 'dotenv/config';
import { launch } from 'cloakbrowser';
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
import { warmUpChallenge } from './scraper.js';
import { collectorConfig } from './config.js';

if (process.argv[2] === 'discover') {
  const { runDiscover } = await import('./discover.js');
  await runDiscover(process.argv.slice(3));
  process.exit(0);
}

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
log.info(`FETCH_PACING_MS:   ${collectorConfig.fetchPacingMs}`);
log.info(
  `WARMUP_TIMEOUT_MS: ${collectorConfig.challengeWarmupTimeoutMs} (max ${collectorConfig.challengeWarmupMaxAttempts} attempts)`
);
log.info(`BROWSER:          ${collectorConfig.headless ? 'headless' : 'headed'} (humanize: ${collectorConfig.humanize})`);
if (collectorConfig.proxyUrl) {
  const masked = collectorConfig.proxyUrl.replace(/\/\/[^@]*@/, '//***@');
  log.info(
    `PROXY:            ${masked} (geoip: ${collectorConfig.geoip})`
  );
} else {
  log.info(`PROXY:            none (geoip: ${collectorConfig.geoip})`);
}
log.info(`LOG_LEVEL:        ${collectorConfig.logLevel}`);
if (collectorConfig.webhookUrl)
  log.info(`WEBHOOK_URL:      ${collectorConfig.webhookUrl}`);
if (collectorConfig.electionSourcePath)
  log.info(`ELECTION_SOURCE:   ${collectorConfig.electionSourcePath}`);
log.info(`Electorates:      ${electorateConfigs.length}`);
log.info('=============================');

async function runOnce(): Promise<void> {
  const browser = await launch({
    headless: collectorConfig.headless,
    humanize: collectorConfig.humanize,
    ...(collectorConfig.proxyUrl
      ? { proxy: collectorConfig.proxyUrl }
      : {}),
    geoip: collectorConfig.geoip,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  // One shared context per cycle: every electorate page (and the challenge
  // warm-up) rides the same cookie jar, so a cf_clearance cookie solved once
  // is reused across all electorates. (Playwright's browser.newPage() would
  // create a fresh context per page and lose the cookies.)
  const context = await browser.newContext();

  try {
    // Solve the Cloudflare challenge (if present) once per cycle so the
    // cf_clearance cookie rides in this browser context for all electorates.
    const warmupUrl = electorateConfigs[0]?.url;
    if (warmupUrl) {
      await warmUpChallenge(
        context,
        warmupUrl,
        collectorConfig.challengeWarmupTimeoutMs,
        collectorConfig.challengeWarmupMaxAttempts
      );
    }

    const payload = await scrapeCycle({
      context,
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
    await context.close().catch((err) =>
      log.error('Error closing browser context', err)
    );
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

process.on('SIGINT', () => {
  disconnectWs();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectWs();
  closeDb();
  process.exit(0);
});
