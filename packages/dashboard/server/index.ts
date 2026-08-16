import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Server } from 'socket.io';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { ResultsPayload, MetricEvent } from '@election-night/core/types';
import { createHistorySource, type HistorySource } from './history-upstream.js';
import { dashboardServerConfig } from './config.js';
import {
  applyMetricEvents,
  websocketClients,
  lastScrapeTimestampSeconds,
} from './metrics.js';
import {
  serveHealth,
  serveMetrics,
  serveReady,
  serveStatic,
} from './static.js';
import { serveApi } from './api.js';
import {
  addFeedEvents,
  buildFeedEvents,
  currentFeedEvents,
  loadFeedEvents,
  resetFeedState,
} from './feed.js';
import { withMutex, Mutex } from './mutex.js';
import { log } from './logger.js';

const {
  wsPort: PORT,
  cachePath: CACHE_PATH,
  distDir: DIST_DIR,
  maxFeedEvents: MAX_FEED_EVENTS,
} = dashboardServerConfig;

let latestResults: ResultsPayload | null = null;
const feedMutex = new Mutex();

function loadCachedResults() {
  if (existsSync(CACHE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
      latestResults = {
        electorateResults: data,
        partyVote: [],
        partyLists: [],
      };
      log.info(`Loaded cached results from ${CACHE_PATH}`);
      return;
    } catch (err) {
      log.error('Failed to load cached results:', err);
    }
  }
  log.info('No cached results found, waiting for first scrape...');
}

const historySource: HistorySource = createHistorySource({
  baseUrl: dashboardServerConfig.historyUpstream,
});

const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
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
      await withMutex(feedMutex, async () => {
        latestResults = null;
        resetFeedState();
        historySource.clearCache();
        io.emit('clear');
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Feed cleared' }));
      return;
    }

    if (url) {
      if (url.pathname === '/metrics') return serveMetrics(req, res);
      if (url.pathname === '/health') return serveHealth(req, res);
      if (url.pathname === '/ready')
        return serveReady(req, res, historySource, currentFeedEvents());

      try {
        if (await serveApi(req, res, url, historySource)) return;
      } catch (err) {
        // History upstream unreachable and nothing cached — degrade to 502
        // rather than crashing the server on an unhandled rejection.
        log.error('API route failed:', err);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'history upstream unavailable' }));
        }
        return;
      }
    }

    serveStatic(req, res);
  }
);

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

  socket.on('results_update', (payload: ResultsPayload) => {
    withMutex(feedMutex, async () => {
      const previousResults = latestResults?.electorateResults ?? [];
      latestResults = payload;
      lastScrapeTimestampSeconds.set(Date.now() / 1000);
      log.info('Received results update, broadcasting...');
      socket.broadcast.emit('results_update', payload);

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
    }).catch((err) => log.error('results_update handler failed:', err));
  });

  socket.on('disconnect', () => {
    log.info(`Client disconnected: ${socket.id}`);
    websocketClients.set(io.engine.clientsCount);
  });

  socket.on('metrics', (events: MetricEvent | MetricEvent[]) => {
    applyMetricEvents(events);
  });
});

server.listen(PORT, () => {
  log.info('=== Dashboard Server Configuration ===');
  log.info(`WS_PORT:           ${PORT}`);
  log.info(`HISTORY_UPSTREAM:  ${dashboardServerConfig.historyUpstream}`);
  log.info(`DIST_DIR:          ${DIST_DIR}`);
  log.info(`CACHE_PATH:        ${resolve(CACHE_PATH)}`);
  log.info(`MAX_FEED_EVENTS:   ${MAX_FEED_EVENTS}`);
  log.info(`CWD:               ${process.cwd()}`);
  log.info('======================================');
  log.info(`Socket.io server running on http://localhost:${PORT}`);
  loadCachedResults();
  loadFeedEvents();
});

process.on('SIGINT', () => {
  log.info('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Shutting down...');
  process.exit(0);
});

export function stopDashboardServer(): void {
  io.close();
  server.close();
}

export { server, io };
