import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Application-tier metrics owned by the dashboard server and exposed on
 * `GET /metrics` (scraped by Fly).
 *
 * Scope split, so no series has two sources:
 *   - This registry: things only the server can observe — HTTP traffic, socket
 *     delivery, feed state, the history upstream call, and collector liveness.
 *   - `packages/collector/src/metrics.ts`: scrape/cycle/webhook/DB metrics,
 *     scraped from the collector's own `/metrics`.
 *
 * The collector still publishes metric events over Socket.io, but only as a
 * best-effort mirror and heartbeat: the server timestamps receipt
 * (`election_collector_metrics_last_received_timestamp_seconds`) and does not
 * re-register the series.
 */
export const register = new Registry();

const latencyBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export const websocketClients = new Gauge({
  name: 'election_websocket_clients_connected',
  help: 'Number of connected dashboard clients',
  registers: [register],
});

export const feedEventsTotal = new Counter({
  name: 'election_feed_events_total',
  help: 'Total number of feed events generated',
  labelNames: ['type'],
  registers: [register],
});

export const feedEventsStored = new Gauge({
  name: 'election_feed_events_stored',
  help: 'Feed events currently retained in the server cache',
  registers: [register],
});

export const lastScrapeTimestampSeconds = new Gauge({
  name: 'election_last_scrape_timestamp_seconds',
  help: 'Unix timestamp of the last received scrape update',
  registers: [register],
});

export const collectorMetricsLastReceived = new Gauge({
  name: 'election_collector_metrics_last_received_timestamp_seconds',
  help: 'Unix timestamp of the last metric event received from the collector',
  registers: [register],
});

/**
 * Whether `GET /metrics` reached and merged the collector's registry on the last
 * scrape. Fly scrapes exactly one metrics endpoint per process, so the
 * collector's series are pulled through this server rather than scraped
 * directly — this gauge is how you alert on that hop breaking.
 */
export const collectorMetricsReachable = new Gauge({
  name: 'election_collector_metrics_reachable',
  help: "1 when the collector's metrics were merged on the last scrape (or merging is disabled), 0 when the collector was unreachable",
  registers: [register],
});

export const socketMessagesTotal = new Counter({
  name: 'election_socket_messages_total',
  help: 'Socket.io messages handled by the dashboard server',
  labelNames: ['direction', 'event'],
  registers: [register],
});

// `route` is always a route template (e.g. /api/history/electorate/:name),
// never a raw path, so cardinality stays bounded.
export const httpRequestsTotal = new Counter({
  name: 'election_http_requests_total',
  help: 'HTTP requests handled by the dashboard server',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'election_http_request_duration_seconds',
  help: 'HTTP request duration on the dashboard server',
  labelNames: ['method', 'route'],
  buckets: latencyBuckets,
  registers: [register],
});

// Collector → dashboard history API (`/history/*` on the collector).
export const historyUpstreamTotal = new Counter({
  name: 'election_history_upstream_requests_total',
  help: 'History upstream (collector REST API) requests',
  labelNames: ['route', 'outcome'],
  registers: [register],
});

export const historyUpstreamDuration = new Histogram({
  name: 'election_history_upstream_request_duration_seconds',
  help: 'History upstream request duration',
  labelNames: ['route'],
  buckets: latencyBuckets,
  registers: [register],
});

export const historyCacheEvents = new Counter({
  name: 'election_history_cache_events_total',
  help: 'History response cache events',
  labelNames: ['result'],
  registers: [register],
});

export const buildInfo = new Gauge({
  name: 'election_build_info',
  help: 'Build metadata; value is always 1',
  labelNames: ['version', 'revision'],
  registers: [register],
});

/**
 * Called once at startup by the server entrypoint (which has the Node `process`
 * global); kept out of module scope so this file stays importable from the
 * frontend `src` project via tests.
 */
export function setBuildInfo(version: string, revision: string): void {
  buildInfo.set({ version, revision }, 1);
}

// Seed the liveness gauges with process start so a fresh deploy has a grace
// window before the "pipeline stalled" alert can fire.
const startedAtSeconds = Date.now() / 1000;
lastScrapeTimestampSeconds.set(startedAtSeconds);
collectorMetricsLastReceived.set(startedAtSeconds);
// 0 until the first successful merge, so an unreachable collector is visible
// immediately rather than as an absent series.
collectorMetricsReachable.set(0);

/** Called whenever the collector publishes anything over Socket.io. */
export function noteCollectorHeartbeat(): void {
  collectorMetricsLastReceived.set(Date.now() / 1000);
}

/** The metrics owned by this process, without the collector merge. */
export async function serverMetrics(): Promise<string> {
  return register.metrics();
}

/** Drop a whole metric family (HELP, TYPE and samples) from an exposition. */
function stripMetricFamily(text: string, name: string): string {
  return text
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith(`# HELP ${name}`) &&
        !line.startsWith(`# TYPE ${name}`) &&
        !line.startsWith(`${name} `) &&
        !line.startsWith(`${name}{`)
    )
    .join('\n');
}

/**
 * Merge the collector's registry into this process's exposition.
 *
 * Prometheus rejects a body with a duplicate HELP/TYPE line for the same metric
 * family, and both processes expose `election_build_info`, so the collector's
 * copy is dropped. Both run the same image, and the collector's own `/metrics`
 * still serves its copy for standalone deployments.
 */
export function mergeMetrics(
  serverText: string,
  collectorText: string
): string {
  const collector = stripMetricFamily(
    collectorText,
    'election_build_info'
  ).trim();
  if (!collector) return serverText;
  return `${serverText.trimEnd()}\n${collector}\n`;
}
