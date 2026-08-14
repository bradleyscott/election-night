import 'dotenv/config';
import { z } from 'zod';

/**
 * Parse a boolean from an env var that must be exactly 'true' or 'false'.
 * (z.coerce.boolean() treats the string 'false' as true — avoid that trap.)
 */
function envBoolean(dflt: boolean) {
  return z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? dflt : v === 'true'));
}

const collectorConfigSchema = z.object({
  baseResultsUrl: z
    .string()
    .optional()
    .describe('Base URL of the election results site'),
  pollIntervalMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(120_000)
    .describe('Time between scrape polls'),
  wsPort: z.coerce.number().int().min(1).max(65535).default(3456),
  wsUrl: z.string().default('ws://localhost:3456'),
  concurrency: z.coerce.number().int().min(1).default(10),
  navigationTimeoutMs: z.coerce.number().int().min(1000).default(120_000),
  fetchPacingMs: z.coerce
    .number()
    .int()
    .min(0)
    .default(300)
    .describe('Average delay between electorate fetches (jittered 0.5x-1.5x)'),
  challengeWarmupTimeoutMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(180_000)
    .describe(
      'Per-attempt timeout when solving the Cloudflare challenge on browser launch'
    ),
  challengeWarmupMaxAttempts: z.coerce.number().int().min(1).default(3),
  challengeWarmupEnabled: envBoolean(true).describe(
    'Run the Cloudflare challenge warm-up at browser launch (true|false); disable on trusted egress (e.g. a home connection) where the site serves results directly'
  ),
  logLevel: z.coerce.number().int().min(0).max(3).default(3),
  healthPort: z.coerce.number().int().min(1024).max(65535).default(3459),
  historyToken: z
    .string()
    .optional()
    .describe(
      'Bearer token for the /history REST endpoints on the health port; unset disables them'
    ),
  dbPath: z.string().default('.data/election_results.db'),
  webhookUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined))
    .describe('Webhook URL for result events'),
  electionSourcePath: z.string().optional(),
  wsReconnectDelayMs: z.coerce.number().int().min(100).default(2_000),
  proxyUrl: z
    .string()
    .optional()
    .describe(
      'cloakbrowser proxy URL (e.g. http://user:pass@host:port) for residential/alternate egress'
    ),
  geoip: envBoolean(false).describe(
    'Match timezone/locale/WebRTC to the (proxy) exit IP (true|false)'
  ),
  humanize: envBoolean(true).describe(
    'Human-like mouse, keyboard and scroll behavior (true|false)'
  ),
  headless: envBoolean(true).describe(
    'Run the stealth browser headless (true|false); false needs a display (e.g. Xvfb on servers)'
  ),
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

function loadCollectorConfig(): CollectorConfig {
  const parsed = collectorConfigSchema.safeParse({
    baseResultsUrl: process.env.BASE_RESULTS_URL,
    pollIntervalMs: process.env.POLL_INTERVAL_MS,
    wsPort: process.env.WS_PORT,
    wsUrl: process.env.WS_URL,
    concurrency: process.env.CONCURRENCY,
    navigationTimeoutMs: process.env.NAVIGATION_TIMEOUT_MS,
    fetchPacingMs: process.env.FETCH_PACING_MS,
    challengeWarmupTimeoutMs: process.env.CHALLENGE_WARMUP_TIMEOUT_MS,
    challengeWarmupMaxAttempts: process.env.CHALLENGE_WARMUP_MAX_ATTEMPTS,
    challengeWarmupEnabled: process.env.CHALLENGE_WARMUP_ENABLED,
    logLevel: process.env.LOG_LEVEL,
    healthPort: process.env.HEALTH_PORT,
    historyToken: process.env.HISTORY_TOKEN,
    dbPath: process.env.DB_PATH,
    webhookUrl: process.env.WEBHOOK_URL,
    electionSourcePath: process.env.ELECTION_SOURCE_PATH,
    wsReconnectDelayMs: process.env.WS_RECONNECT_DELAY_MS,
    proxyUrl: process.env.CLOAKBROWSER_PROXY,
    geoip: process.env.CLOAKBROWSER_GEOIP,
    humanize: process.env.CLOAKBROWSER_HUMANIZE,
    headless: process.env.CLOAKBROWSER_HEADLESS,
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
