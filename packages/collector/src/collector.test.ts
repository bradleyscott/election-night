import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ResultsPayload } from '@election-night/core/types';

const mockLoadSource = vi.fn();
const mockWriteResults = vi.fn();
const mockProcessResults = vi.fn();

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
    electionSourcePath: undefined,
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

vi.mock('./source-loader.js', () => ({
  loadSource: () => mockLoadSource(),
}));

const { startCollector, stopCollector, collectorState } = await import(
  './collector.js'
);

const CONFIG = {
  electorateName: 'Auckland Central',
  url: 'https://example.test/e01/e01.xml',
};

function sourceReturning(fetchResults: () => Promise<unknown>) {
  return {
    getName: () => 'Test Source',
    loadElectorates: async () => [CONFIG],
    loadPartyList: async () => [],
    fetchResults,
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

async function runCycle(
  source: unknown,
  done: () => boolean
): Promise<number> {
  mockLoadSource.mockResolvedValue({
    source,
    configs: [CONFIG],
    partyListRecords: [],
  });
  const before = collectorState.cycleCount;
  await startCollector();
  await waitUntil(() => collectorState.cycleCount > before && done());
  stopCollector();
  return before;
}

describe('collector loop', () => {
  beforeEach(() => {
    mockLoadSource.mockReset();
    mockWriteResults.mockReset();
    mockProcessResults.mockReset();
  });

  test('writes a snapshot and publishes when electorates are fetched', async () => {
    const onResults = vi.fn<(p: ResultsPayload) => void>();
    const source = sourceReturning(async () => ({
      electorateName: 'Auckland Central',
      candidateVotes: [{ candidate: 'Alice', votes: 1000, party: 'Red Party' }],
      partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
      votesCounted: 1000,
      votePercentageCounted: 0.5,
    }));

    await runCycle(source, () => collectorState.lastCycleFinishedAt !== null);

    expect(mockWriteResults).toHaveBeenCalledTimes(1);
    expect(mockWriteResults.mock.calls[0]![3]).toBe('2026');
    expect(collectorState.lastCycleOk).toBe(true);
    expect(collectorState.lastResultCount).toBe(1);
    expect(collectorState.lastVotesCounted).toBe(1000);
    expect(onResults).not.toHaveBeenCalled(); // not wired in this run
    expect(mockProcessResults).toHaveBeenCalledTimes(1);
  });

  /**
   * The guard that replaced the results cache's whole-payload fallback: if
   * every fetch fails, writing would add a duplicate snapshot (and, on a cold
   * DB, an empty one), so the last good state is left alone instead.
   */
  test('skips the snapshot write when nothing could be fetched', async () => {
    const source = sourceReturning(async () => {
      throw new Error('feed down');
    });

    await runCycle(source, () => collectorState.lastError !== null);

    expect(mockWriteResults).not.toHaveBeenCalled();
    expect(mockProcessResults).not.toHaveBeenCalled();
    expect(collectorState.lastCycleOk).toBe(false);
    expect(collectorState.lastError).toMatch(/no electorates fetched/);
  });

  test('reports the payload to onResults when a cycle succeeds', async () => {
    const onResults = vi.fn<(p: ResultsPayload) => void>();
    const source = sourceReturning(async () => ({
      electorateName: 'Auckland Central',
      candidateVotes: [{ candidate: 'Alice', votes: 10, party: 'Red Party' }],
      partyVotes: [{ candidate: 'Red Party', votes: 10 }],
      votesCounted: 10,
      votePercentageCounted: 0.1,
    }));

    mockLoadSource.mockResolvedValue({
      source,
      configs: [CONFIG],
      partyListRecords: [],
    });
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
});
