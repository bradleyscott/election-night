import 'dotenv/config';
import { z } from 'zod';

const collectorConfigSchema = z.object({
  electionYear: z
    .string()
    .default('2023')
    .describe(
      'Election year for the XML feed, e.g. 2020, 2023, 2026. Builds https://electionresults.govt.nz/electionresults_<year>/xml/'
    ),
  xmlFeedBaseUrl: z
    .string()
    .optional()
    .describe(
      'Full override for the XML feed base URL, must end with a trailing slash (e.g. a mock XML server); takes precedence over ELECTION_YEAR'
    ),
  pollIntervalMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(120_000)
    .describe('Time between scrape polls'),
  wsPort: z.coerce.number().int().min(1).max(65535).default(3456),
  wsUrl: z.string().default('ws://localhost:3456'),
  concurrency: z.coerce.number().int().min(1).default(10),
  fetchTimeoutMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(30_000)
    .describe('Per-request HTTP timeout for XML feed fetches'),
  fetchPacingMs: z.coerce
    .number()
    .int()
    .min(0)
    .default(300)
    .describe('Average delay between electorate fetches (jittered 0.5x-1.5x)'),
  logLevel: z.coerce.number().int().min(0).max(3).default(3),
  healthPort: z.coerce.number().int().min(1024).max(65535).default(3459),
  dbPath: z.string().default('.data/election_results.db'),
  resultsCachePath: z
    .string()
    .default('.data/electorate_results.json')
    .describe(
      'JSON cache of the last cycle electorate results (webhook diff baseline)'
    ),
  webhookUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined))
    .describe('Webhook URL for result events'),
  electionSourcePath: z.string().optional(),
  wsReconnectDelayMs: z.coerce.number().int().min(100).default(2_000),
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

function loadCollectorConfig(): CollectorConfig {
  const parsed = collectorConfigSchema.safeParse({
    electionYear: process.env.ELECTION_YEAR,
    xmlFeedBaseUrl: process.env.XML_FEED_BASE_URL,
    pollIntervalMs: process.env.POLL_INTERVAL_MS,
    wsPort: process.env.WS_PORT,
    wsUrl: process.env.WS_URL,
    concurrency: process.env.CONCURRENCY,
    fetchTimeoutMs: process.env.FETCH_TIMEOUT_MS,
    fetchPacingMs: process.env.FETCH_PACING_MS,
    logLevel: process.env.LOG_LEVEL,
    healthPort: process.env.HEALTH_PORT,
    dbPath: process.env.DB_PATH,
    resultsCachePath: process.env.RESULTS_CACHE_PATH,
    webhookUrl: process.env.WEBHOOK_URL,
    electionSourcePath: process.env.ELECTION_SOURCE_PATH,
    wsReconnectDelayMs: process.env.WS_RECONNECT_DELAY_MS,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Invalid collector configuration:\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const collectorConfig = loadCollectorConfig();
