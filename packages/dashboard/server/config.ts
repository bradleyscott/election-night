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
  feedCachePath: z.string().default('.data/feed_events.json'),
  maxFeedEvents: z.coerce.number().int().min(1).default(200),
  historyUpstream: z
    .string()
    .url()
    .default('http://127.0.0.1:3459')
    .describe(
      'Base URL of the collector history REST API. The server never reads a SQLite DB — it always fetches /api/history/* from here. Default suits a co-located collector; point it at the homelab collector in split deployments'
    ),
});

export type DashboardServerConfig = z.infer<typeof dashboardServerConfigSchema>;

function loadDashboardServerConfig(): DashboardServerConfig {
  const parsed = dashboardServerConfigSchema.safeParse({
    wsPort: process.env.WS_PORT,
    distDir: process.env.DIST_DIR,
    cachePath: process.env.CACHE_PATH,
    feedCachePath: process.env.FEED_CACHE_PATH,
    maxFeedEvents: process.env.MAX_FEED_EVENTS,
    historyUpstream: process.env.HISTORY_UPSTREAM,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Invalid dashboard server configuration:\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const dashboardServerConfig = loadDashboardServerConfig();
