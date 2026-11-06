import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { scrapeCycle, scrapeCycleWithMeta } from './scrape-cycle.js';
import type {
  ElectionSource,
  ElectorateConfig,
  NationalStatus,
} from '@election-night/core/types';

const NATIONAL_STATUS: NationalStatus = {
  parties: [
    {
      party: 'Red Party',
      votes: 1000,
      listSeats: 0,
      electorateSeats: 1,
      totalSeats: 1,
    },
    {
      party: 'Blue Party',
      votes: 500,
      listSeats: 0,
      electorateSeats: 0,
      totalSeats: 0,
    },
  ],
  totalVotesCast: 1500,
  percentVotesCast: 50,
  totalElectoratesFinal: 1,
  percentElectoratesFinal: 100,
  totalMinimalVotes: 0,
  totalSpecialVotes: 0,
  updated: null,
};

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
    loadNationalStatus: vi.fn(async () => NATIONAL_STATUS),
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

describe('scrapeCycleWithMeta — conditional feed reads', () => {
  const config: ElectorateConfig = {
    electorateName: 'Auckland Central',
    url: 'https://example.test/e01/e01.xml',
  };

  const SEAT = {
    electorateName: 'Auckland Central',
    candidateVotes: [{ candidate: 'Alice', votes: 1000, party: 'Red Party' }],
    partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
    votesCounted: 1000,
    votePercentageCounted: 0.5,
  };

  const STAMP = 'Fri, 06 Nov 2026 03:19:53 GMT';

  beforeEach(() => {
    mockReadResults.mockReset();
    mockPublishMetrics.mockReset();
    mockReadResults.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function conditionalSource(
    ifModifiedSince: (
      config: ElectorateConfig,
      since: string
    ) => Promise<unknown>,
    fetchResults = vi.fn()
  ): ElectionSource {
    return {
      getName: () => 'Test Source',
      loadElectorates: vi.fn(),
      loadPartyList: vi.fn(),
      loadNationalStatus: vi.fn(async () => NATIONAL_STATUS),
      fetchResults,
      fetchResultsConditional: ifModifiedSince as never,
    };
  }

  test('a seat that answers not-modified keeps its cached result and its stamp', async () => {
    mockReadResults.mockReturnValue([SEAT]);
    const fetchResults = vi.fn();
    const source = conditionalSource(async () => ({
      status: 'not-modified',
      lastModified: STAMP,
    }), fetchResults);

    const outcome = await scrapeCycleWithMeta({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      conditional: true,
      previousStamps: new Map([[config.electorateName, STAMP]]),
    });

    // The body was never requested, and nothing downstream sees a gap.
    expect(fetchResults).not.toHaveBeenCalled();
    expect(outcome.refreshed).toBe(0);
    expect(outcome.advanced).toBe(false);
    expect(outcome.payload.electorateResults).toHaveLength(1);
    expect(outcome.payload.electorateResults[0].candidateVotes[0].votes).toBe(
      1000
    );
    expect(outcome.stamps.get(config.electorateName)).toBe(STAMP);
  });

  test('a seat whose stamp moved reports the cycle as advanced', async () => {
    const source = conditionalSource(async () => ({
      status: 'modified',
      results: SEAT,
      lastModified: STAMP,
    }));

    const outcome = await scrapeCycleWithMeta({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      conditional: true,
      previousStamps: new Map([
        [config.electorateName, 'Thu, 05 Nov 2026 09:00:00 GMT'],
      ]),
    });

    expect(outcome.refreshed).toBe(1);
    expect(outcome.advanced).toBe(true);
    expect(outcome.stamps.get(config.electorateName)).toBe(STAMP);
  });

  test('an unconditional sweep is not mistaken for a change', async () => {
    // Every file comes back 200 on a sweep, so "a body arrived" proves nothing.
    // Only a stamp that differs from the one we held counts.
    const source = makeSource(vi.fn().mockResolvedValue(SEAT));

    const outcome = await scrapeCycleWithMeta({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      conditional: false,
      previousStamps: new Map([[config.electorateName, STAMP]]),
    });

    expect(outcome.refreshed).toBe(1);
    expect(outcome.advanced).toBe(false);
    expect(outcome.stamps.get(config.electorateName)).toBe(STAMP);
  });

  test('a first cycle with no stamps advances, so the first payload publishes', async () => {
    const source = makeSource(vi.fn().mockResolvedValue(SEAT));

    const outcome = await scrapeCycleWithMeta({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      conditional: false,
      previousStamps: new Map(),
    });

    expect(outcome.advanced).toBe(true);
  });

  test('drops the stamp when not-modified arrives with nothing cached', async () => {
    // A stamp describing data we have never held would pin the seat to a hole
    // forever: the next cycle would 304 again. Forget it so it refetches.
    const source = conditionalSource(async () => ({
      status: 'not-modified',
      lastModified: STAMP,
    }));

    const outcome = await scrapeCycleWithMeta({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      conditional: true,
      previousStamps: new Map([[config.electorateName, STAMP]]),
    });

    expect(outcome.stamps.has(config.electorateName)).toBe(false);
    expect(outcome.payload.electorateResults).toHaveLength(0);
  });
});
