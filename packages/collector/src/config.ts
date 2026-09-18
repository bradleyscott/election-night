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
  /**
   * Whether this process polls the feed. The collector runs in-process with
   * the dashboard server, so `false` turns the deployment into a
   * dashboard-only node serving the last written snapshot (PR previews).
   */
  collectorEnabled: z
    .boolean()
    .default(true)
    .describe('Run the in-process collector loop (default true)'),
  pollIntervalMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(30_000)
    .describe(
      'Time between polls. The feed is a cached static asset (max-age 30s) and a full cycle takes about a second, so polling more often than the CDN refreshes gains nothing'
    ),
  concurrency: z.coerce.number().int().min(1).default(10),
  fetchTimeoutMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(5_000)
    .describe(
      'Per-request HTTP timeout for XML feed fetches (responses are ~13ms; this is a hang guard, not a latency budget)'
    ),
  logLevel: z.coerce.number().int().min(0).max(3).default(3),
  dbPath: z.string().default('.data/election_results.db'),
  webhookUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined))
    .describe('Webhook URL for result events'),
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

function loadCollectorConfig(): CollectorConfig {
  const parsed = collectorConfigSchema.safeParse({
    electionYear: process.env.ELECTION_YEAR,
    xmlFeedBaseUrl: process.env.XML_FEED_BASE_URL,
    collectorEnabled: booleanFromEnv(process.env.COLLECTOR_ENABLED),
    pollIntervalMs: process.env.POLL_INTERVAL_MS,
    concurrency: process.env.CONCURRENCY,
    fetchTimeoutMs: process.env.FETCH_TIMEOUT_MS,
    logLevel: process.env.LOG_LEVEL,
    dbPath: process.env.DB_PATH,
    webhookUrl: process.env.WEBHOOK_URL,
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

/** `COLLECTOR_ENABLED=false` disables the loop; anything else leaves the default. */
function booleanFromEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value !== 'false';
}

export const collectorConfig = loadCollectorConfig();
