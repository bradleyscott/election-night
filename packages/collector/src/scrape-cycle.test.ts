import { describe, expect, test, vi } from 'vitest';
import { scrapeCycle } from './scrape-cycle.js';
import type {
  ElectorateConfig,
  ElectionSource,
  ElectorateResults,
  MetricEvent,
} from '@election-night/core/types';

function makeSource(
  fetchResults: ElectionSource['fetchResults']
): ElectionSource {
  return {
    getName: () => 'Test Source',
    loadElectorates: vi.fn(),
    loadPartyList: vi.fn(),
    fetchResults,
  };
}

const config: ElectorateConfig = {
  electorateName: 'Auckland Central',
  url: 'https://example.test/e01/e01.xml',
};

function previousResult(
  overrides: Partial<ElectorateResults> = {}
): ElectorateResults {
  return {
    electorateName: 'Auckland Central',
    candidateVotes: [{ candidate: 'Alice', votes: 900, party: 'Red Party' }],
    partyVotes: [{ candidate: 'Red Party', votes: 900 }],
    votesCounted: 900,
    votePercentageCounted: 0.4,
    ...overrides,
  };
}

describe('scrapeCycle', () => {
  test('reports a fetch failure when there is no previous snapshot to reuse', async () => {
    const source = makeSource(
      vi.fn().mockRejectedValue(new Error('fetch failed'))
    );

    const result = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
    });

    expect(source.fetchResults).toHaveBeenCalledWith(config);
    expect(result.payload.electorateResults).toHaveLength(0);
    expect(result).toMatchObject({ fresh: 0, fallback: 0, failed: 1, total: 1 });
  });

  test('reuses the previous snapshot for an electorate that fails twice', async () => {
    const source = makeSource(
      vi.fn().mockRejectedValue(new Error('fetch failed'))
    );

    const result = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      fallback: [previousResult()],
    });

    // Reused, so the payload keeps the electorate and the metrics distinguish
    // it from a fresh read.
    expect(result.payload.electorateResults).toHaveLength(1);
    expect(result).toMatchObject({ fresh: 0, fallback: 1, failed: 0, total: 1 });
  });

  test('retries once before falling back', async () => {
    const fetchResults = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(previousResult({ votesCounted: 1500 }));
    const source = makeSource(fetchResults);

    const result = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      fallback: [previousResult()],
    });

    expect(fetchResults).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ fresh: 1, fallback: 0, failed: 0 });
    expect(result.payload.electorateResults[0]!.votesCounted).toBe(1500);
  });

  test('parses results returned by the source', async () => {
    const source = makeSource(
      vi.fn().mockResolvedValue({
        electorateName: 'Auckland Central',
        candidateVotes: [{ candidate: 'Alice', votes: 1000, party: 'Red Party' }],
        partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
        votesCounted: 1000,
        votePercentageCounted: 0.5,
      })
    );

    const result = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
    });

    expect(source.fetchResults).toHaveBeenCalledWith(config);
    expect(result.payload.electorateResults).toHaveLength(1);
    expect(result.payload.electorateResults[0]!.electorateName).toBe(
      'Auckland Central'
    );
    expect(result.payload.electorateResults[0]!.candidateVotes[0]!.party).toBe(
      'Red Party'
    );
  });

  test('attributes the leading candidate party from the candidate itself', async () => {
    const source = makeSource(
      vi.fn().mockResolvedValue({
        electorateName: 'Auckland Central',
        candidateVotes: [
          { candidate: 'Alice', votes: 1000, party: 'Red Party' },
          { candidate: 'Bob', votes: 500, party: 'Blue Party' },
        ],
        partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
        votesCounted: 1500,
        votePercentageCounted: 0.5,
      })
    );

    const result = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
    });

    expect(
      result.payload.electorateResults[0]!.leaders.leadingCandidateParty
    ).toBe('Red Party');
    expect(
      result.payload.electorateResults[0]!.leaders.secondCandidateParty
    ).toBe('Blue Party');
  });

  test('reports per-electorate metrics through onMetrics', async () => {
    const onMetrics = vi.fn<(events: MetricEvent | MetricEvent[]) => void>();
    const source = makeSource(
      vi.fn().mockResolvedValue(previousResult({ votesCounted: 1000 }))
    );

    await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      onMetrics,
    });

    const events = onMetrics.mock.calls[0]![0] as MetricEvent[];
    expect(events).toContainEqual({
      metric: 'scrapeDurationSeconds',
      seconds: expect.any(Number),
      status: 'success',
    });
    expect(events).toContainEqual({
      metric: 'scrapeElectoratesTotal',
      status: 'success',
    });
  });
});
