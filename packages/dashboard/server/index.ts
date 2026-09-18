import 'dotenv/config';
import { Server } from 'socket.io';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { ResultsPayload } from '@election-night/core/types';
import {
  collectorConfig,
  collectorState,
  createResultsDb,
  startCollector,
  stopCollector,
  type ResultsDb,
} from '@election-night/collector';
import { dashboardServerConfig } from './config.js';
import {
  applyMetricEvents,
  websocketClients,
  lastScrapeTimestampSeconds,
} from './metrics.js';
import { serveHealth, serveMetrics, serveReady } from './health.js';
import { serveStatic } from './static.js';
import { serveApi } from './api.js';
import {
  addFeedEvents,
  buildFeedEvents,
  currentFeedEvents,
  loadFeedEvents,
  resetFeedState,
} from './feed.js';
import { withMutex, Mutex } from './mutex.js';
import { collectorStatus } from './ready-check.js';
import { log } from './logger.js';

const { wsPort: PORT, distDir: DIST_DIR, maxFeedEvents: MAX_FEED_EVENTS } =
  dashboardServerConfig;

/**
 * Snapshots are the only shared state between the collector and this server,
 * so the server reads them straight from SQLite — the same file the in-process
 * collector writes. There is no JSON results cache and no history HTTP hop.
 */
const resultsDb: ResultsDb = createResultsDb({
  dbPath: collectorConfig.dbPath,
  electionYear: collectorConfig.electionYear,
});

let latestResults: ResultsPayload | null = null;
const feedMutex = new Mutex();

function collectorStatusNow() {
  return collectorStatus({
    enabled: collectorConfig.collectorEnabled,
    cycleCount: collectorState.cycleCount,
    lastCycleOk: collectorState.lastCycleOk,
  });
}

/** Rehydrate live state from the newest snapshot so the UI is populated on boot. */
function seedFromLatestSnapshot(): void {
  const latest = resultsDb.latestPayload();
  if (!latest) {
    log.info('No snapshot for this cycle yet, waiting for the first scrape...');
    return;
  }
  latestResults = latest;
  lastScrapeTimestampSeconds.set(Date.now() / 1000);
  log.info(
    `Loaded latest snapshot: ${latest.electorateResults.length} electorates, ${latest.partyVote.length} parties`
  );
}

/**
 * Hand a freshly written payload to every connected client and generate feed
 * events from the difference against the payload we last broadcast.
 */
function publishResults(payload: ResultsPayload): void {
  withMutex(feedMutex, () => {
    const previousResults = latestResults?.electorateResults ?? [];
    latestResults = payload;
    lastScrapeTimestampSeconds.set(Date.now() / 1000);

    io.emit('results_update', payload);
    log.info('Broadcast results to connected clients');

    const rawEvents = buildFeedEvents(
      previousResults,
      payload.electorateResults
    );
    if (rawEvents.length === 0) return;

    const newEvents = addFeedEvents(rawEvents);
    if (newEvents.length > 0) {
      log.info(`Generated ${newEvents.length} feed events`);
      io.emit('feed_update', newEvents);
    }
  }).catch((err) => log.error('Failed to publish results:', err));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = req.url
    ? new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    : null;

  // POST /api/clear — reset feed state and notify all connected clients.
  // Optionally guarded by a shared secret when CLEAR_TOKEN is configured.
  if (req.method === 'POST' && url?.pathname === '/api/clear') {
    if (
      dashboardServerConfig.clearToken &&
      req.headers['x-clear-token'] !== dashboardServerConfig.clearToken
    ) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid or missing x-clear-token' }));
      return;
    }
    void withMutex(feedMutex, () => {
      latestResults = null;
      resetFeedState();
      io.emit('clear');
    }).then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Feed cleared' }));
    });
    return;
  }

  if (url) {
    if (url.pathname === '/metrics') return serveMetrics(req, res);
    if (url.pathname === '/health') {
      return serveHealth(req, res, {
        collector: collectorStatusNow(),
        collectorState,
        historyAvailable: resultsDb.isAvailable(),
      });
    }
    if (url.pathname === '/ready') {
      const feedEvents = currentFeedEvents();
      const lastEvent = feedEvents[feedEvents.length - 1];
      return serveReady(req, res, {
        historyAvailable: resultsDb.isAvailable(),
        collector: collectorStatusNow(),
        lastScrape: lastEvent ? lastEvent.timestamp : 'none',
      });
    }

    if (serveApi(req, res, url, resultsDb)) return;
  }

  serveStatic(req, res);
});

const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  log.info(`Client connected: ${socket.id}`);
  websocketClients.set(io.engine.clientsCount);

  if (latestResults) {
    socket.emit('results_update', latestResults);
  }
  const feedEvents = currentFeedEvents();
  if (feedEvents.length > 0) {
    socket.emit('feed_history', feedEvents);
  }

  socket.on('disconnect', () => {
    log.info(`Client disconnected: ${socket.id}`);
    websocketClients.set(io.engine.clientsCount);
  });
});

async function start(): Promise<void> {
  seedFromLatestSnapshot();
  loadFeedEvents();

  if (collectorConfig.collectorEnabled) {
    try {
      await startCollector({
        onResults: publishResults,
        onMetrics: applyMetricEvents,
      });
    } catch (err) {
      // The UI still serves the last written snapshot, so a collector that
      // cannot start must not take the server down.
      log.error('Failed to start the collector:', err);
      collectorState.lastError =
        err instanceof Error ? err.message : String(err);
    }
  } else {
    log.info('COLLECTOR_ENABLED=false — running the dashboard server only');
  }
}

server.listen(PORT, () => {
  log.info('=== Dashboard Server Configuration ===');
  log.info(`WS_PORT:            ${PORT}`);
  log.info(`DIST_DIR:           ${DIST_DIR}`);
  log.info(`DB_PATH:            ${collectorConfig.dbPath}`);
  log.info(`ELECTION_YEAR:      ${collectorConfig.electionYear}`);
  log.info(`COLLECTOR_ENABLED:  ${collectorConfig.collectorEnabled}`);
  log.info(`FEED_CACHE_PATH:    ${dashboardServerConfig.feedCachePath}`);
  log.info(`MAX_FEED_EVENTS:    ${MAX_FEED_EVENTS}`);
  log.info(`CWD:                ${process.cwd()}`);
  log.info('======================================');
  log.info(`Server running on http://localhost:${PORT}`);

  void start();
});

function shutdown(): void {
  log.info('Shutting down...');
  stopCollector();
  resultsDb.close();
  io.close();
  server.close();
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

export function stopDashboardServer(): void {
  shutdown();
}

export { server, io };
