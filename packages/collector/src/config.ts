import 'dotenv/config';
import { z } from 'zod';

const collectorConfigSchema = z.object({
  baseResultsUrl: z
    .string()
    .optional()
    .describe('Base URL of the election results site'),
  resultsTableSelector: z
    .string()
    .optional()
    .describe('Cheerio selector for the outer results container'),
  candidateTableSelector: z
    .string()
    .optional()
    .describe('Cheerio selector for the candidate votes table'),
  partyVoteTableSelector: z
    .string()
    .optional()
    .describe('Cheerio selector for the party vote table'),
  votePercentCountedSelector: z
    .string()
    .optional()
    .describe('Cheerio selector for the percentage counted element'),
  votesCountedSelector: z
    .string()
    .optional()
    .describe('Cheerio selector for the votes counted element'),
  pollIntervalMs: z.coerce
    .number()
    .int()
    .min(1000)
    .default(120_000)
    .describe('Time between scrape polls'),
  wsPort: z.coerce.number().int().min(1).max(65535).default(3456),
  wsUrl: z.string().default('ws://localhost:3456'),
  concurrency: z.coerce.number().int().min(1).default(10),
  navigationTimeoutMs: z.coerce.number().int().min(1000).default(60_000),
  logLevel: z.coerce.number().int().min(0).max(3).default(3),
  dbPath: z.string().default('.data/election_results.db'),
  cachePath: z.string().default('.data/electorate_results.json'),
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
    baseResultsUrl: process.env.BASE_RESULTS_URL,
    resultsTableSelector: process.env.RESULTS_TABLE_SELECTOR,
    candidateTableSelector: process.env.CANDIDATE_TABLE_SELECTOR,
    partyVoteTableSelector: process.env.PARTY_VOTE_TABLE_SELECTOR,
    votePercentCountedSelector: process.env.VOTE_PERCENT_COUNTED_SELECTOR,
    votesCountedSelector: process.env.VOTES_COUNTED_SELECTOR,
    pollIntervalMs: process.env.POLL_INTERVAL_MS,
    wsPort: process.env.WS_PORT,
    wsUrl: process.env.WS_URL,
    concurrency: process.env.CONCURRENCY,
    navigationTimeoutMs: process.env.NAVIGATION_TIMEOUT_MS,
    logLevel: process.env.LOG_LEVEL,
    dbPath: process.env.DB_PATH,
    cachePath: process.env.CACHE_PATH,
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
