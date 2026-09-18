/**
 * The collector loop, as a library.
 *
 * The dashboard server starts this in-process, so results reach the browser
 * without any inter-process hop: the loop writes a snapshot to SQLite, hands
 * the payload to `onResults` (which broadcasts it and generates feed events),
 * and reports metrics through `onMetrics` (which feeds the Prometheus
 * registry the server already exposes).
 *
 * There is deliberately no Socket.io client, no second HTTP server, and no
 * results JSON cache here. Those existed to bridge two processes and to
 * survive a browser-based scraper's per-electorate failures; the XML feed is a
 * cached static asset fetched in about a second, so the SQLite snapshot *is*
 * the shared state.
 */

import type {
  ElectorateConfig,
  ElectionSource,
  MetricEvent,
  PartyList,
  ResultsPayload,
} from '@election-night/core/types';
import { collectorConfig } from './config.js';
import { log } from './logger.js';
import { closeDb, openDb, writeResults } from './db.js';
import { createResultsDb, type ResultsDb } from './query.js';
import { loadSource } from './source-loader.js';
import { processResults } from './results.js';
import { scrapeCycle } from './scrape-cycle.js';

export type CollectorState = {
  running: boolean;
  cycleCount: number;
  lastCycleStartedAt: number | null;
  lastCycleFinishedAt: number | null;
  lastCycleOk: boolean;
  lastError: string | null;
  lastVotesCounted: number | null;
  /** Electorates in the last written snapshot (`null` before the first). */
  lastResultCount: number | null;
  sourceName: string | null;
  electorateCount: number;
};

export const collectorState: CollectorState = {
  running: false,
  cycleCount: 0,
  lastCycleStartedAt: null,
  lastCycleFinishedAt: null,
  lastCycleOk: false,
  lastError: null,
  lastVotesCounted: null,
  lastResultCount: null,
  sourceName: null,
  electorateCount: 0,
};

export type CollectorOptions = {
  /** Called with every freshly written results payload. */
  onResults?: (payload: ResultsPayload) => void;
  /** Called with metric events, to be applied to the server's registry. */
  onMetrics?: (events: MetricEvent | MetricEvent[]) => void;
};

let source: ElectionSource;
let configs: ElectorateConfig[] = [];
let partyListRecords: PartyList[] = [];
let resultsDb: ResultsDb | null = null;
let timer: NodeJS.Timeout | null = null;
let stopped = false;

type CycleOutcome =
  | { status: 'written'; payload: ResultsPayload }
  | { status: 'no-data' }
  | { status: 'skipped' };

function logConfiguration(): void {
  log.info('=== Collector Configuration ===');
  log.info(`DB_PATH:          ${collectorConfig.dbPath}`);
  log.info(`SOURCE:           ${source.getName()}`);
  log.info(`ELECTION_YEAR:    ${collectorConfig.electionYear}`);
  log.info(`POLL_INTERVAL_MS: ${collectorConfig.pollIntervalMs}`);
  log.info(`CONCURRENCY:      ${collectorConfig.concurrency}`);
  log.info(`FETCH_TIMEOUT_MS: ${collectorConfig.fetchTimeoutMs}`);
  log.info(`LOG_LEVEL:        ${collectorConfig.logLevel}`);
  log.info(`Electorates:      ${configs.length}`);
  if (collectorConfig.webhookUrl) {
    log.info(`WEBHOOK_URL:      ${collectorConfig.webhookUrl}`);
  }
  if (collectorConfig.electionSourcePath) {
    log.info(`ELECTION_SOURCE:  ${collectorConfig.electionSourcePath}`);
  }
  log.info('=============================');
}

async function runOnce(
  options: CollectorOptions
): Promise<CycleOutcome> {
  collectorState.cycleCount += 1;
  collectorState.lastCycleStartedAt = Date.now();
  collectorState.lastError = null;

  // Read the previous snapshot before writing: it is both the webhook diff
  // baseline and the per-electorate fallback when a fetch fails.
  const previous = resultsDb?.latestPayload();
  const baseline = previous?.electorateResults ?? [];

  const cycle = await scrapeCycle({
    source,
    configs,
    partyListRecords,
    concurrency: collectorConfig.concurrency,
    fallback: baseline,
    onMetrics: options.onMetrics,
  });

  if (cycle.fresh === 0) {
    // Nothing was fetched, so there is no new information. Writing the
    // all-fallback payload would add a duplicate snapshot (and, on a cold DB,
    // an empty one) — leave the last good state in place instead.
    collectorState.lastCycleOk = false;
    collectorState.lastError = `no electorates fetched (${cycle.failed}/${cycle.total} failed)`;
    log.warn(
      `Skipping snapshot write: no electorates fetched (${cycle.failed}/${cycle.total} failed, ${cycle.fallback} reused)`
    );
    return { status: 'no-data' };
  }

  const { payload } = cycle;

  writeResults(
    payload.electorateResults,
    payload.partyVote,
    payload.partyLists,
    collectorConfig.electionYear
  );
  // Diff against the previous snapshot before the next cycle overwrites it.
  await processResults(payload.electorateResults, baseline, options.onMetrics);

  collectorState.lastCycleFinishedAt = Date.now();
  collectorState.lastCycleOk = true;
  collectorState.lastVotesCounted = payload.electorateResults.reduce(
    (sum, r) => sum + (r.votesCounted || 0),
    0
  );
  collectorState.lastResultCount = payload.electorateResults.length;
  options.onResults?.(payload);

  return { status: 'written', payload };
}

async function loopRun(options: CollectorOptions): Promise<void> {
  try {
    await runOnce(options);
  } catch (err) {
    log.error('Election night cycle failed', err);
    collectorState.lastCycleOk = false;
    collectorState.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    log.info('Processing of results completed!');
  }

  if (stopped) return;
  timer = setTimeout(() => {
    void loopRun(options);
  }, collectorConfig.pollIntervalMs);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load reference data, retrying until it succeeds.
 *
 * A feed outage at boot must not leave the collector permanently off — the
 * dashboard still serves the last written snapshot, so we keep retrying at the
 * poll interval until the source loads.
 */
async function loadSourceUntilReady(): Promise<boolean> {
  while (!stopped) {
    try {
      ({ source, configs, partyListRecords } = await loadSource());
      collectorState.sourceName = source.getName();
      collectorState.electorateCount = configs.length;
      logConfiguration();
      return true;
    } catch (err) {
      collectorState.lastError =
        err instanceof Error ? err.message : String(err);
      collectorState.lastCycleOk = false;
      log.error(
        `Failed to load election source; retrying in ${collectorConfig.pollIntervalMs}ms`,
        err
      );
      await delay(collectorConfig.pollIntervalMs);
    }
  }
  return false;
}

/**
 * Open the DB and start polling. Resolves once the collector is running; the
 * first cycle starts immediately and is not awaited.
 */
export async function startCollector(
  options: CollectorOptions = {}
): Promise<void> {
  if (collectorState.running) return;
  stopped = false;
  collectorState.running = true;

  openDb(collectorConfig.dbPath);
  resultsDb = createResultsDb({
    dbPath: collectorConfig.dbPath,
    electionYear: collectorConfig.electionYear,
  });

  void (async () => {
    if (!(await loadSourceUntilReady())) return;
    log.info('Collector started');
    await loopRun(options);
  })();
}

export function stopCollector(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  collectorState.running = false;
  resultsDb?.close();
  resultsDb = null;
  closeDb();
}
