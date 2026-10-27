import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Server } from 'socket.io';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { ResultsPayload } from '@election-night/core/types';
import type { ComparableResult } from '@election-night/core/diff';
import { buildRuntimeConfig } from '@election-night/core/polls-close';
import { nationalSwingOf, seatChanceFor } from '../src/lib/seat-chance.js';
import { createHistorySource, type HistorySource } from './history-upstream.js';
import { dashboardServerConfig } from './config.js';
import {
  httpRequestDuration,
  httpRequestsTotal,
  lastScrapeTimestampSeconds,
  noteCollectorHeartbeat,
  resultsUpdatesRejectedTotal,
  setBuildInfo,
  socketMessagesTotal,
  websocketClients,
} from './metrics.js';
import { routeLabel } from './routes.js';
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
import { isLoopbackAddress } from './publisher.js';
import { readTaggedCache } from '@election-night/core/tagged-cache';
import { log } from './logger.js';

const {
  wsPort: PORT,
  cachePath: CACHE_PATH,
  distDir: DIST_DIR,
  maxFeedEvents: MAX_FEED_EVENTS,
} = dashboardServerConfig;

setBuildInfo(
  process.env.APP_VERSION ?? 'dev',
  process.env.GIT_SHA ?? 'unknown'
);

let latestResults: ResultsPayload | null = null;
const feedMutex = new Mutex();

/**
 * Build the chance lookup the feed needs for one payload.
 *
 * The seat model needs three things the payload does not carry: the previous
 * cycle's result on these boundaries, the seat's enrolled roll, and the served
 * cycle's turnout/finals constants. All three live on the dashboard side, which
 * is why the feed asks for a lookup rather than deriving a status itself.
 */
function chanceLookupFor(
  electorates: ResultsPayload['electorateResults']
):
  ((result: ComparableResult) => ReturnType<typeof seatChanceFor>) | undefined {
  const electionYear = dashboardServerConfig.electionYear;
  if (!electionYear) return undefined;
  const results = electorates as Parameters<typeof nationalSwingOf>[0];
  const swing = nationalSwingOf(results, electionYear);
  return (result) => seatChanceFor(result, electionYear, swing);
}

function loadCachedResults() {
  if (existsSync(CACHE_PATH)) {
    let raw: string;
    try {
      raw = readFileSync(CACHE_PATH, 'utf-8');
    } catch (err) {
      log.error('Failed to read cached results:', err);
      return;
    }

    const cached = readTaggedCache<ResultsPayload['electorateResults'][number]>(
      {
        raw,
        key: 'results',
        payloadNoun: 'results',
        expectedYear: dashboardServerConfig.electionYear,
      }
    );
    if (cached.ok) {
      latestResults = {
        electorateResults: cached.items,
        partyVote: [],
        partyLists: [],
      };
      log.info(`Loaded cached results from ${CACHE_PATH}`);
      return;
    }

    // The cache is the collector's diff baseline, so it may be absent, from a
    // different cycle, or written by an older version. None of those are worth
    // failing over — the first scrape replaces it within a poll interval.
    log.warn(
      `Ignoring cached results at ${CACHE_PATH}: cache ${cached.reason}`
    );
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

    // Per-route RED metrics. `finish` fires once the response is complete, so
    // `statusCode` is final by then.
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const method = req.method ?? 'GET';
      const route = routeLabel(url?.pathname ?? '/');
      httpRequestsTotal.inc({
        method,
        route,
        status_code: String(res.statusCode),
      });
      httpRequestDuration.observe(
        { method, route },
        Number(process.hrtime.bigint() - startedAt) / 1e9
      );
    });

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
        socketMessagesTotal.inc({ direction: 'out', event: 'clear' });
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Feed cleared' }));
      return;
    }

    if (url) {
      if (url.pathname === '/metrics') return serveMetrics(req, res);
      // Runtime facts the SPA cannot know at build time (the cycle it is
      // serving, and when polls close for that cycle). Cheap and upstream-free.
      if (url.pathname === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(buildRuntimeConfig(dashboardServerConfig.electionYear))
        );
        return;
      }
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
    socketMessagesTotal.inc({ direction: 'out', event: 'results_update' });
  }
  const feedEvents = currentFeedEvents();
  if (feedEvents.length > 0) {
    socket.emit('feed_history', feedEvents);
    socketMessagesTotal.inc({ direction: 'out', event: 'feed_history' });
  }

  socket.on('results_update', (payload: ResultsPayload) => {
    socketMessagesTotal.inc({ direction: 'in', event: 'results_update' });

    // Name the publisher in the log: a payload from anywhere but the
    // co-located collector sets `latestResults` for every visitor and is
    // re-emitted on connect, so it outlives the process that received it being
    // restarted. Without this line the source of a wrong-cycle payload is
    // invisible from the outside.
    const electorates = payload?.electorateResults ?? [];
    const clientIp =
      socket.handshake.headers['fly-client-ip'] ??
      socket.handshake.headers['x-forwarded-for'];
    const userAgent = socket.handshake.headers['user-agent'] ?? 'none';
    const origin =
      socket.handshake.headers['origin'] ??
      socket.handshake.headers['referer'] ??
      'none';
    log.info(
      `results_update from ${socket.handshake.address}${
        clientIp ? ` (client ${clientIp})` : ''
      }: ua=${userAgent} origin=${origin} query=${JSON.stringify(
        socket.handshake.query
      )} electorates=${electorates.length}, first=${
        electorates[0]?.electorateName ?? 'none'
      }, partyLists=${payload?.partyLists?.length ?? 0}`
    );

    if (
      !dashboardServerConfig.allowRemoteResults &&
      !isLoopbackAddress(socket.handshake.address)
    ) {
      resultsUpdatesRejectedTotal.inc({ reason: 'remote-publisher' });
      log.warn(
        `Ignoring results_update from ${socket.handshake.address}: only the co-located collector may publish (set ALLOW_REMOTE_RESULTS=true for a split deployment)`
      );
      return;
    }

    withMutex(feedMutex, async () => {
      const previousResults = latestResults?.electorateResults ?? [];
      latestResults = payload;
      lastScrapeTimestampSeconds.set(Date.now() / 1000);
      log.info('Received results update, broadcasting...');
      socket.broadcast.emit('results_update', payload);
      socketMessagesTotal.inc({ direction: 'out', event: 'results_update' });

      const rawEvents = buildFeedEvents(
        previousResults,
        payload.electorateResults,
        // The feed says "likely to win" only because the page shows a chance;
        // both read the same model, so the two cannot describe one count
        // differently. Without a served cycle there is no prior, and the events
        // fall back to count-only copy.
        chanceLookupFor(payload.electorateResults)
      );
      if (rawEvents.length === 0) return;

      const newEvents = addFeedEvents(rawEvents);
      if (newEvents.length > 0) {
        log.info(`Generated ${newEvents.length} feed events`);
        io.emit('feed_update', newEvents);
        socketMessagesTotal.inc({ direction: 'out', event: 'feed_update' });
      }
    }).catch((err) => log.error('results_update handler failed:', err));
  });

  socket.on('disconnect', () => {
    log.info(`Client disconnected: ${socket.id}`);
    websocketClients.set(io.engine.clientsCount);
  });

  socket.on('metrics', () => {
    socketMessagesTotal.inc({ direction: 'in', event: 'metrics' });
    noteCollectorHeartbeat();
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
