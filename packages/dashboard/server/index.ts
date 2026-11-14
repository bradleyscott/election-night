import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Server } from 'socket.io';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type {
  ResultsEnvelope,
  ResultsPayload,
} from '@election-night/core/types';
import { buildRuntimeConfig } from '@election-night/core/polls-close';
import { chanceLookupFor } from '@election-night/core/notional-baseline';
import { baselineFor } from '../src/lib/seat-chance.js';
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
import { serveHealth, serveMetrics, serveReady } from './health.js';
import { canonicalRedirect } from './redirect.js';
import { createStaticHandler } from './static.js';
import { serveApi } from './api.js';
import {
  startCollectorWatchdog,
  watchdogEnabledFromEnv,
  type CollectorWatchdog,
} from './collector-watchdog.js';
import {
  addFeedEvents,
  buildFeedEvents,
  currentFeedEvents,
  adoptFeedEvents,
  loadFeedEvents,
  resetFeedState,
} from './feed.js';
import { classifyResultsEnvelope } from './results-envelope.js';
import { parseResultsEnvelope } from './validation.js';
import { withMutex, Mutex } from './mutex.js';
import { isAuthorizedPublisher, isLoopbackAddress } from './publisher.js';
import { readTaggedCache } from '@election-night/core/tagged-cache';
import { decideDurableBoot } from './durable-state.js';
import {
  FEED_EVENTS_PATH,
  buildFeedEventsBody,
  decideFeedRecovery,
  parseFeedEventsBody,
  type FeedEventsBody,
} from './feed-recovery.js';
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
let latestEnvelope: ResultsEnvelope | null = null;
let latestRevision: number | null = null;
const feedMutex = new Mutex();

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
      latestEnvelope = {
        payload: latestResults,
        electionYear: dashboardServerConfig.electionYear ?? null,
        revision: null,
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

/**
 * The retained payload, recovered from the collector's durable latest state.
 *
 * `loadCachedResults` above can only restore electorates: `RESULTS_CACHE_PATH`
 * is the collector's diff baseline, not a payload, so it carries no party vote
 * and no party lists. That is enough to draw a map and not enough to draw
 * seats, parties or candidates. It was also, after the preliminary count, the
 * only payload this server would ever hold — the Commission's media feed stops
 * answering once the count is in (2026: a 404 on every path), so the collector
 * publishes nothing and no scrape ever replaces the preload. The site then
 * waited for results that had been in SQLite since the count finished.
 *
 * `/history/latest` is the authoritative full payload that the history API
 * promises a restart recovers parties and lists from, and it lives beside this
 * process on the same volume. So ask it at boot, after the seat cache as the
 * cheap fallback. `decideDurableBoot` holds the judgement about when to trust
 * the copy; this only logs it and publishes it to connecting browsers.
 */
async function loadDurableResults(): Promise<RecoveryOutcome> {
  const latest = await historySource.latest().catch(() => null);
  const decision = decideDurableBoot({
    latest,
    configuredYear: dashboardServerConfig.electionYear,
    currentRevision: latestRevision,
  });

  if (decision.kind === 'ignored') {
    log.debug(
      `Not recovering durable results from ${dashboardServerConfig.historyUpstream}/history/latest: ${decision.reason}` +
        (latest?.reason ? ` (${latest.reason})` : '')
    );
    // Only an upstream that could not be reached is worth waiting for: an
    // empty, foreign-cycle or superseded row will still be those later.
    return decision.reason === 'degraded' ? 'retry' : 'settled';
  }

  const { payload } = decision.envelope;
  latestResults = payload;
  latestEnvelope = decision.envelope;
  log.info(
    `Loaded durable results from history upstream: ${payload.electorateResults.length} electorates, ` +
      `${payload.partyVote.length} parties, ${payload.partyLists.length} list candidates`
  );
  return 'recovered';
}

/**
 * The retained feed events, adopted from the configured upstream when this
 * process has none of its own.
 *
 * A machine with a volume reloads its feed cache at boot and this declines
 * (`has-local`). A preview has neither a volume nor a collector, so its Live
 * Feed panel was the one region that could never render — a page contradicting
 * itself, which reads as a bug rather than as the artefact it is. Adopting the
 * upstream's events makes the preview show the events production actually
 * holds; `decideFeedRecovery` refuses an empty or foreign-cycle body rather
 * than showing one.
 *
 * Clients that were already connected miss the on-connect frame, so the
 * adopted set is broadcast once as well.
 */
async function loadUpstreamFeedEvents(): Promise<RecoveryOutcome> {
  const base = dashboardServerConfig.historyUpstream.replace(/\/+$/, '');
  const url = `${base}${FEED_EVENTS_PATH}`;

  if (currentFeedEvents().length > 0) return 'settled';

  let body: FeedEventsBody | null = null;
  let reached = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    reached = res.ok;
    if (res.ok) body = parseFeedEventsBody(await res.json());
  } catch {
    // Unreachable: `null` reaches the same 'invalid' decision, but the
    // upstream may simply not be listening yet.
  }

  const decision = decideFeedRecovery({
    body,
    configuredYear: dashboardServerConfig.electionYear,
    localCount: currentFeedEvents().length,
  });

  if (decision.kind === 'ignored') {
    log.debug(`Not adopting feed events from ${url}: ${decision.reason}`);
    // A body we reached and refused is final; a refusal to answer is not.
    return decision.reason === 'invalid' && !reached ? 'retry' : 'settled';
  }

  const adopted = adoptFeedEvents(decision.events);
  log.info(`Adopted ${adopted} feed events from ${url}`);
  io.emit('feed_history', currentFeedEvents());
  socketMessagesTotal.inc({ direction: 'out', event: 'feed_history' });
  return 'recovered';
}

/**
 * How long the boot recovery keeps asking the upstream for its durable state.
 *
 * The container's entrypoint starts this server *first* and the collector
 * second, on purpose — the public health check must answer immediately — and
 * the collector takes seconds to compile and open SQLite. A single read at
 * boot therefore lands on a closed port, decides `degraded`, and used to keep
 * the seats-only cache for the life of the process: production served
 * `partyVote: []`, so Seats rendered 0 seats over a fully counted election and
 * nothing ever replaced it, because on a quiet feed the collector publishes
 * nothing to replace it with.
 *
 * So keep asking. Loopback reads are free, the retry stops the moment either
 * read succeeds or returns something terminal, and the window is long enough
 * to outlast a cold start but short enough to leave an honest warning when the
 * collector really is gone.
 */
const RECOVERY_WINDOW_MS = 5 * 60_000;
const RECOVERY_MAX_DELAY_MS = 15_000;

type RecoveryOutcome = 'recovered' | 'retry' | 'settled';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function recoverFromUpstream(): Promise<void> {
  const startedAt = Date.now();
  let results: RecoveryOutcome = 'retry';
  let feed: RecoveryOutcome = 'retry';

  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(RECOVERY_MAX_DELAY_MS, 500 * 2 ** (attempt - 1)));
    }
    if (results === 'retry') results = await loadDurableResults();
    if (feed === 'retry') feed = await loadUpstreamFeedEvents();

    if (results !== 'retry' && feed !== 'retry') break;
    if (Date.now() - startedAt >= RECOVERY_WINDOW_MS) break;
  }

  if (results === 'retry') {
    log.warn(
      `Gave up recovering durable results from ${dashboardServerConfig.historyUpstream} after ` +
        `${Math.round((Date.now() - startedAt) / 1000)}s; serving the seat cache only`
    );
  }
  if (feed === 'retry') {
    log.warn(
      `Gave up recovering feed events from ${dashboardServerConfig.historyUpstream} after ` +
        `${Math.round((Date.now() - startedAt) / 1000)}s`
    );
  }
}

const historySource: HistorySource = createHistorySource({
  baseUrl: dashboardServerConfig.historyUpstream,
});

/**
 * The collector's HTTP surface can stop answering while its scrape loop and
 * Socket.io publishing continue. The dashboard's own `/health` cannot see
 * that, so this process probes the collector and exits when it stays wedged;
 * the entrypoint treats either process dying as fatal and the platform
 * restarts the machine. Started below, once this server is listening.
 */
let watchdog: CollectorWatchdog | null = null;

const serveStatic = createStaticHandler(DIST_DIR);

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

    // Canonical hostname: `www.<CANONICAL_HOST>` answers with the app today,
    // because the proxy routes on Host but does not rewrite it. Collapse the
    // alias before any route runs so the redirect is not route-specific.
    const redirect = canonicalRedirect({
      host: req.headers.host,
      method: req.method,
      pathname: url?.pathname ?? '/',
      search: url?.search,
      canonicalHost: dashboardServerConfig.canonicalHost,
    });
    if (redirect) {
      res.writeHead(redirect.status, { Location: redirect.location });
      res.end();
      return;
    }

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
        latestEnvelope = null;
        latestRevision = null;
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
      // The feed's durable read. Read-only and unauthenticated, like the
      // history proxy: it is the same events this process sends a browser on
      // connect, and it is what lets a machine without a volume show them.
      if (url.pathname === '/api/feed-events') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify(
            buildFeedEventsBody(
              currentFeedEvents(),
              dashboardServerConfig.electionYear
            )
          )
        );
        return;
      }
      if (url.pathname === '/health') return serveHealth(req, res);
      if (url.pathname === '/ready')
        return serveReady(req, res, currentFeedEvents());

      try {
        if (await serveApi(req, res, url, historySource, latestRevision))
          return;
      } catch (err) {
        // An unexpected history failure (bug, malformed route, unexpected
        // throw). Upstream unavailability is handled inside serveApi as a
        // structured 503, so this is the last-resort degrade rather than the
        // normal "collector is down" path.
        log.error('API route failed:', err);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'history upstream unavailable' }));
        }
        return;
      }
    }

    await serveStatic(req, res);
  }
);

const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  // Debug, not info: a busy night's connect/disconnect chatter otherwise
  // floods the log stream. `websocketClients` below is the count that matters.
  log.debug(`Client connected: ${socket.id}`);
  websocketClients.set(io.engine.clientsCount);

  if (latestEnvelope) {
    socket.emit('results_update', latestEnvelope);
    socketMessagesTotal.inc({ direction: 'out', event: 'results_update' });
  } else if (latestResults) {
    socket.emit('results_update', {
      payload: latestResults,
      electionYear: dashboardServerConfig.electionYear ?? null,
      revision: latestRevision,
    } satisfies ResultsEnvelope);
    socketMessagesTotal.inc({ direction: 'out', event: 'results_update' });
  }
  const feedEvents = currentFeedEvents();
  if (feedEvents.length > 0) {
    socket.emit('feed_history', feedEvents);
    socketMessagesTotal.inc({ direction: 'out', event: 'feed_history' });
  }

  socket.on(
    'results_update',
    (
      data: ResultsEnvelope | ResultsPayload,
      ack?: (response: {
        ok: boolean;
        duplicate?: boolean;
        revision?: number | null;
        error?: string;
      }) => void
    ) => {
      socketMessagesTotal.inc({ direction: 'in', event: 'results_update' });

      const envelope = parseResultsEnvelope(data);
      if (!envelope) {
        ack?.({ ok: false, error: 'invalid payload' });
        log.warn('Rejected results_update: invalid payload');
        return;
      }
      const payload = envelope.payload;

      const reject = (error: string) => {
        ack?.({ ok: false, error });
        log.warn(`Rejected results_update: ${error}`);
      };

      // Name the publisher in the log: a payload from anywhere but the
      // co-located collector sets `latestResults` for every visitor and is
      // re-emitted on connect, so it outlives the process that received it
      // being restarted. Without this line the source of a wrong-cycle payload
      // is invisible from the outside.
      const electorates = payload.electorateResults;
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
        }, partyLists=${payload.partyLists?.length ?? 0}, revision=${
          envelope.revision ?? 'legacy'
        }, cycle=${envelope.electionYear ?? 'unknown'}`
      );

      const remote = !isLoopbackAddress(socket.handshake.address);
      const token =
        typeof socket.handshake.auth?.token === 'string'
          ? socket.handshake.auth.token
          : undefined;
      if (
        !isAuthorizedPublisher({
          remote,
          allowRemote: dashboardServerConfig.allowRemoteResults,
          token,
          expectedToken: dashboardServerConfig.resultsToken,
        })
      ) {
        resultsUpdatesRejectedTotal.inc({ reason: 'remote-publisher' });
        reject(
          remote
            ? 'remote publisher is not authenticated (RESULTS_TOKEN)'
            : 'publisher rejected'
        );
        return;
      }

      const decision = classifyResultsEnvelope(envelope, {
        electionYear: dashboardServerConfig.electionYear ?? null,
        latestRevision,
      });
      if (decision.kind === 'reject') {
        if (decision.reason.startsWith('wrong cycle')) {
          resultsUpdatesRejectedTotal.inc({ reason: 'wrong-cycle' });
        } else if (decision.reason.startsWith('older revision')) {
          resultsUpdatesRejectedTotal.inc({ reason: 'older-revision' });
        }
        reject(decision.reason);
        return;
      }
      if (decision.kind === 'duplicate') {
        // Accepted, but already applied: acknowledge without deriving a
        // second set of feed events.
        ack?.({ ok: true, duplicate: true, revision: envelope.revision });
        return;
      }

      withMutex(feedMutex, async () => {
        const previousResults = latestResults?.electorateResults ?? [];
        latestResults = payload;
        latestEnvelope = envelope;
        if (envelope.revision !== null) latestRevision = envelope.revision;
        lastScrapeTimestampSeconds.set(Date.now() / 1000);
        log.info('Received results update, broadcasting...');
        socket.broadcast.emit('results_update', envelope);
        socketMessagesTotal.inc({ direction: 'out', event: 'results_update' });

        const rawEvents = buildFeedEvents(
          previousResults,
          payload.electorateResults,
          chanceLookupFor(
            baselineFor(dashboardServerConfig.electionYear),
            payload.electorateResults,
            dashboardServerConfig.electionYear
          )
        );
        if (rawEvents.length === 0) return;

        const newEvents = addFeedEvents(rawEvents);
        if (newEvents.length > 0) {
          log.info(`Generated ${newEvents.length} feed events`);
          io.emit('feed_update', newEvents);
          socketMessagesTotal.inc({ direction: 'out', event: 'feed_update' });
        }
      })
        .then(() =>
          ack?.({
            ok: true,
            duplicate: false,
            revision: envelope.revision,
          })
        )
        .catch((err) => {
          log.error('results_update handler failed:', err);
          ack?.({ ok: false, error: 'handler failed' });
        });
    }
  );

  socket.on('disconnect', () => {
    log.debug(`Client disconnected: ${socket.id}`);
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
  log.info(
    `CANONICAL_HOST:    ${dashboardServerConfig.canonicalHost ?? '(none)'}`
  );
  log.info(`CWD:               ${process.cwd()}`);
  log.info('======================================');
  log.info(`Socket.io server running on http://localhost:${PORT}`);
  loadCachedResults();
  loadFeedEvents();
  // Then the durable full payload, which is the only copy carrying parties and
  // lists; the seat cache above is the fallback when the collector is absent.
  // Then the durable state, retried until the collector is up: the entrypoint
  // starts this server before it.
  void recoverFromUpstream();

  if (watchdogEnabledFromEnv()) {
    watchdog = startCollectorWatchdog({
      baseUrl: dashboardServerConfig.historyUpstream,
    });
    log.info(
      `Collector health watchdog enabled: ${dashboardServerConfig.historyUpstream}/health`
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('Shutting down...');
    process.exit(0);
  });
}

export function stopDashboardServer(): void {
  watchdog?.stop();
  watchdog = null;
  io.close();
  server.close();
}

export { server, io };
