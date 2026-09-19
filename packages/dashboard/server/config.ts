import 'dotenv/config';
import { resolve } from 'path';
import { z } from 'zod';

const dashboardServerConfigSchema = z.object({
  wsPort: z.coerce.number().int().min(1).max(65535).default(3456),
  distDir: z
    .string()
    .default('./dist')
    .transform((v) => resolve(v)),
  cachePath: z.string().default('.data/electorate_results.json'),
  /**
   * Election cycle this server is serving (`ELECTION_YEAR`). Used to reject a
   * preloaded results cache from a different cycle. Optional: when unset, a
   * tagged cache is still read but an untagged (pre-2026) one is accepted
   * unverified.
   */
  electionYear: z.string().optional(),
  feedCachePath: z.string().default('.data/feed_events.json'),
  maxFeedEvents: z.coerce.number().int().min(1).default(200),
  historyUpstream: z
    .string()
    .url()
    .default('http://127.0.0.1:3459')
    .describe(
      'Base URL of the collector history REST API. The server never reads a SQLite DB — it always fetches /api/history/* from here. Default suits a co-located collector; point it at the collector in split deployments'
    ),
  /**
   * Fly scrapes exactly one metrics endpoint per process, so `GET /metrics` on
   * the server merges the collector's registry over loopback. Unset derives it
   * from `HISTORY_UPSTREAM` (the collector's health port also serves /metrics);
   * set it to an empty string to disable the merge.
   */
  collectorMetricsUrl: z
    .string()
    .optional()
    .describe(
      'URL of the collector application metrics merged into GET /metrics. Defaults to <HISTORY_UPSTREAM>/metrics; set empty to disable'
    ),
  clearToken: z
    .string()
    .optional()
    .describe(
      'When set, POST /api/clear requires this shared secret in the x-clear-token header (unset = open, as before)'
    ),
});

export type DashboardServerConfig = z.infer<typeof dashboardServerConfigSchema>;

function loadDashboardServerConfig(): DashboardServerConfig {
  const parsed = dashboardServerConfigSchema.safeParse({
    wsPort: process.env.WS_PORT,
    distDir: process.env.DIST_DIR,
    cachePath: process.env.CACHE_PATH,
    electionYear: process.env.ELECTION_YEAR,
    feedCachePath: process.env.FEED_CACHE_PATH,
    maxFeedEvents: process.env.MAX_FEED_EVENTS,
    historyUpstream: process.env.HISTORY_UPSTREAM,
    collectorMetricsUrl: process.env.COLLECTOR_METRICS_URL,
    clearToken: process.env.CLEAR_TOKEN,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Invalid dashboard server configuration:\n${issues}`);
    process.exit(1);
  }

  const config = parsed.data;
  config.collectorMetricsUrl =
    config.collectorMetricsUrl === ''
      ? undefined
      : (config.collectorMetricsUrl ??
        `${config.historyUpstream.replace(/\/+$/, '')}/metrics`);

  return config;
}

export const dashboardServerConfig = loadDashboardServerConfig();
