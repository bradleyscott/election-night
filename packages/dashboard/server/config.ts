import 'dotenv/config';
import { resolve } from 'path';
import { z } from 'zod';

/**
 * Dashboard-server-only configuration.
 *
 * Collector settings (feed year, poll interval, DB path, webhook URL) live in
 * `collectorConfig` (`@election-night/collector`) — the collector runs
 * in-process, so duplicating them here would create two sources of truth.
 */
const dashboardServerConfigSchema = z.object({
  wsPort: z.coerce.number().int().min(1).max(65535).default(3456),
  distDir: z
    .string()
    .default('./dist')
    .transform((v) => resolve(v)),
  feedCachePath: z.string().default('.data/feed_events.json'),
  maxFeedEvents: z.coerce.number().int().min(1).default(200),
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
    feedCachePath: process.env.FEED_CACHE_PATH,
    maxFeedEvents: process.env.MAX_FEED_EVENTS,
    clearToken: process.env.CLEAR_TOKEN,
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
