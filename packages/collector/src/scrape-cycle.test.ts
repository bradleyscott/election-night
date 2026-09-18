import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { scrapeCycle } from './scrape-cycle.js';
import type {
  ElectionSource,
  ElectorateConfig,
} from '@election-night/core/types';

const mockReadResults = vi.fn();
const mockPublishMetrics = vi.fn();

vi.mock('./results.js', () => ({
  readResults: () => mockReadResults(),
}));

vi.mock('./ws-client.js', () => ({
  publishMetrics: (...args: unknown[]) => mockPublishMetrics(...args),
}));

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

describe('scrapeCycle', () => {
  beforeEach(() => {
    mockReadResults.mockReset();
    mockPublishMetrics.mockReset();
    mockReadResults.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('treats a fetch failure as a failed scrape and falls back to cached results', async () => {
    const config: ElectorateConfig = {
      electorateName: 'Auckland Central',
      url: 'https://example.test/e01/e01.xml',
    };

    const source = makeSource(
      vi.fn().mockRejectedValue(new Error('fetch failed'))
    );

    const payload = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
    });

    expect(source.fetchResults).toHaveBeenCalledWith(config);
    expect(payload.electorateResults).toHaveLength(0);
  });

  test('parses results returned by the source', async () => {
    const config: ElectorateConfig = {
      electorateName: 'Auckland Central',
      url: 'https://example.test/e01/e01.xml',
    };

    const source = makeSource(
      vi.fn().mockResolvedValue({
        electorateName: 'Auckland Central',
        candidateVotes: [
          { candidate: 'Alice', votes: 1000, party: 'Red Party' },
        ],
        partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
        votesCounted: 1000,
        votePercentageCounted: 0.5,
      })
    );

    const payload = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
    });

    expect(source.fetchResults).toHaveBeenCalledWith(config);
    expect(payload.electorateResults).toHaveLength(1);
    expect(payload.electorateResults[0].electorateName).toBe(
      'Auckland Central'
    );
    expect(payload.electorateResults[0].candidateVotes[0].party).toBe(
      'Red Party'
    );
  });

  test('attributes the leading candidate party from the candidate itself', async () => {
    const config: ElectorateConfig = {
      electorateName: 'Auckland Central',
      url: 'https://example.test/e01/e01.xml',
    };

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

    const payload = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
    });

    expect(payload.electorateResults[0].leaders.leadingCandidateParty).toBe(
      'Red Party'
    );
    expect(payload.electorateResults[0].leaders.secondCandidateParty).toBe(
      'Blue Party'
    );
  });
});
