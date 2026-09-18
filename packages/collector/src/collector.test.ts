import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ResultsPayload } from '@election-night/core/types';

const mockWriteResults = vi.fn();
const mockProcessResults = vi.fn();

/**
 * Stand-in for the XML source. The loader lives inside `collector.ts`, so the
 * class it constructs is what the test controls.
 */
const mockSource = vi.hoisted(() => ({
  name: 'Test Source',
  configs: [
    {
      electorateName: 'Auckland Central',
      url: 'https://example.test/e01/e01.xml',
    },
  ],
  fetchResults: (async () => {
    throw new Error('unset');
  }) as (config: unknown) => Promise<unknown>,
}));

vi.mock('@election-night/core/sources', () => ({
  NzElectionXmlSource: class {
    getName() {
      return mockSource.name;
    }
    async loadElectorates() {
      return mockSource.configs;
    }
    async loadPartyList() {
      return [];
    }
    fetchResults(config: unknown) {
      return mockSource.fetchResults(config);
    }
  },
}));

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./config.js', () => ({
  collectorConfig: {
    dbPath: ':memory:',
    electionYear: '2026',
    pollIntervalMs: 60_000,
    concurrency: 2,
    fetchTimeoutMs: 1_000,
    logLevel: 3,
    xmlFeedBaseUrl: undefined,
    webhookUrl: undefined,
  },
}));

vi.mock('./db.js', () => ({
  openDb: vi.fn(),
  closeDb: vi.fn(),
  writeResults: (...args: unknown[]) => mockWriteResults(...args),
}));

// The previous snapshot doubles as the fallback; return none so a failing
// fetch has nothing to reuse.
vi.mock('./query.js', () => ({
  createResultsDb: () => ({ latestPayload: () => null, close: vi.fn() }),
}));

vi.mock('./results.js', () => ({
  processResults: (...args: unknown[]) => mockProcessResults(...args),
}));

const { startCollector, stopCollector, collectorState } = await import(
  './collector.js'
);

function result(votes = 1000) {
  return {
    electorateName: 'Auckland Central',
    candidateVotes: [{ candidate: 'Alice', votes, party: 'Red Party' }],
    partyVotes: [{ candidate: 'Red Party', votes }],
    votesCounted: votes,
    votePercentageCounted: 0.5,
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for the collector cycle');
}

/** Run exactly one cycle, then stop the loop. */
async function runCycle(
  done: () => boolean,
  onMetrics?: (events: unknown) => void
): Promise<void> {
  const before = collectorState.cycleCount;
  await startCollector({ onMetrics });
  await waitUntil(() => collectorState.cycleCount > before && done());
  stopCollector();
}

describe('collector loop', () => {
  beforeEach(() => {
    mockWriteResults.mockReset();
    mockProcessResults.mockReset();
    mockSource.fetchResults = async () => {
      throw new Error('unset');
    };
  });

  test('writes a snapshot and publishes when electorates are fetched', async () => {
    mockSource.fetchResults = async () => result();

    await runCycle(() => collectorState.lastCycleFinishedAt !== null);

    expect(mockWriteResults).toHaveBeenCalledTimes(1);
    expect(mockWriteResults.mock.calls[0]![3]).toBe('2026');
    expect(collectorState.lastCycleOk).toBe(true);
    expect(collectorState.lastResultCount).toBe(1);
    expect(collectorState.lastVotesCounted).toBe(1000);
    expect(mockProcessResults).toHaveBeenCalledTimes(1);
  });

  /**
   * The guard that replaced the results cache's whole-payload fallback: if
   * every fetch fails, writing would add a duplicate snapshot (and, on a cold
   * DB, an empty one), so the last good state is left alone instead.
   */
  test('skips the snapshot write when nothing could be fetched', async () => {
    mockSource.fetchResults = async () => {
      throw new Error('feed down');
    };

    await runCycle(() => collectorState.lastError !== null);

    expect(mockWriteResults).not.toHaveBeenCalled();
    expect(mockProcessResults).not.toHaveBeenCalled();
    expect(collectorState.lastCycleOk).toBe(false);
    expect(collectorState.lastError).toMatch(/no electorates fetched/);
  });

  test('reports the payload to onResults when a cycle succeeds', async () => {
    mockSource.fetchResults = async () => result(10);
    const onResults = vi.fn<(p: ResultsPayload) => void>();

    const before = collectorState.cycleCount;
    await startCollector({ onResults });
    await waitUntil(
      () =>
        collectorState.cycleCount > before &&
        collectorState.lastCycleFinishedAt !== null
    );
    stopCollector();

    expect(onResults).toHaveBeenCalledTimes(1);
    expect(onResults.mock.calls[0]![0].electorateResults).toHaveLength(1);
  });

  /**
   * Regression guard: the loop used to call `processResults` without the
   * metrics callback, so `election_webhook_publishes_total` was never
   * incremented — the metric existed but was always empty.
   */
  test('forwards onMetrics to processResults so webhook publishes are counted', async () => {
    mockSource.fetchResults = async () => result(10);
    const onMetrics = vi.fn<(e: unknown) => void>();

    await runCycle(
      () => collectorState.lastCycleFinishedAt !== null,
      onMetrics
    );

    expect(mockProcessResults).toHaveBeenCalledTimes(1);
    expect(mockProcessResults.mock.calls[0]![2]).toBe(onMetrics);
  });
});
