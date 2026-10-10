import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TABLES = [
  'scrape_snapshots',
  'electorate_results',
  'electorate_summary',
  'party_vote_results',
  'party_vote_summary',
  'party_lists',
];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clear-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** One electorate snapshot, so the clear has real rows to remove. */
const sampleResults: Results[] = [
  {
    electorateName: 'Test Electorate',
    partyVotes: [{ candidate: 'National Party', votes: 5000 }],
    candidateVotes: [
      { candidate: 'Smith, John', party: 'National Party', votes: 5200 },
      { candidate: 'Jones, Mary', party: 'Labour Party', votes: 4800 },
    ],
    votesCounted: 10000,
    votePercentageCounted: 0.8,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 400,
      marginPercent: 0.04,
      predictionStatus: 'too-close',
    },
    marginOfError: 0.02,
  },
];

describe('runClear', () => {
  test('truncates every table and deletes both JSON caches', async () => {
    const dbPath = join(dir, 'election_results.db');
    const resultsCache = join(dir, 'electorate_results.json');
    const feedCache = join(dir, 'feed_events.json');

    const { openDb, closeDb, writeResults } = await import('./db.js');
    openDb(dbPath);
    writeResults(sampleResults, [], [], '2023');
    closeDb();

    writeFileSync(
      resultsCache,
      JSON.stringify({ electionYear: '2023', results: sampleResults })
    );
    writeFileSync(feedCache, JSON.stringify([{ id: 'e1' }]));

    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('RESULTS_CACHE_PATH', resultsCache);
    vi.stubEnv('FEED_CACHE_PATH', feedCache);

    const { runClear } = await import('./clear.js');
    await runClear();

    const db = new Database(dbPath, { readonly: true });
    try {
      for (const table of TABLES) {
        const { c } = db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get() as {
          c: number;
        };
        expect(c, `${table} should be empty`).toBe(0);
      }
    } finally {
      db.close();
    }

    expect(existsSync(resultsCache)).toBe(false);
    expect(existsSync(feedCache)).toBe(false);
  });

  test('deletes the feed cache even with no database present', async () => {
    // Guards the regression this test was added for: the feed cache used to
    // survive a clear, so a previous cycle's events were preloaded as the
    // current cycle's feed on the next boot.
    const feedCache = join(dir, 'feed_events.json');
    writeFileSync(feedCache, JSON.stringify([{ id: 'e1' }]));

    vi.stubEnv('DB_PATH', join(dir, 'does-not-exist.db'));
    vi.stubEnv('RESULTS_CACHE_PATH', join(dir, 'no-results-cache.json'));
    vi.stubEnv('FEED_CACHE_PATH', feedCache);

    const { runClear } = await import('./clear.js');
    await runClear();

    expect(existsSync(feedCache)).toBe(false);
  });
});
