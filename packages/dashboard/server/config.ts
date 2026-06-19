import 'dotenv/config';
import { resolve } from 'path';
import { z } from 'zod';

const dashboardServerConfigSchema = z.object({
  wsPort: z.coerce.number().int().min(1).max(65535).default(3456),
  dbPath: z.string().default('.data/election_results.db'),
  distDir: z
    .string()
    .default('./dist')
    .transform((v) => resolve(v)),
  cachePath: z.string().default('.data/electorate_results.json'),
  feedCachePath: z.string().default('.data/feed_events.json'),
  maxFeedEvents: z.coerce.number().int().min(1).default(200),
});

export type DashboardServerConfig = z.infer<
  typeof dashboardServerConfigSchema
>;

function loadDashboardServerConfig(): DashboardServerConfig {
  const parsed = dashboardServerConfigSchema.safeParse({
    wsPort: process.env.WS_PORT,
    dbPath: process.env.DB_PATH,
    distDir: process.env.DIST_DIR,
    cachePath: process.env.CACHE_PATH,
    feedCachePath: process.env.FEED_CACHE_PATH,
    maxFeedEvents: process.env.MAX_FEED_EVENTS,
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
