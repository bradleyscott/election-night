import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { scrapeCycle } from './scrape-cycle.js';
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

    const { payload } = await scrapeCycle({
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

    const { payload } = await scrapeCycle({
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

    const { payload } = await scrapeCycle({
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

describe('scrapeCycle — conditional feed reads', () => {
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
    const source = conditionalSource(
      async () => ({
        status: 'not-modified',
        lastModified: STAMP,
      }),
      fetchResults
    );

    const outcome = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map([[config.electorateName, STAMP]]),
    });

    // The body was never requested, and nothing downstream sees a gap.
    expect(fetchResults).not.toHaveBeenCalled();
    expect(outcome.counts.unchanged).toBe(1);
    expect(outcome.counts.fresh).toBe(0);
    expect(outcome.payload.electorateResults).toHaveLength(1);
    expect(outcome.payload.electorateResults[0].candidateVotes[0].votes).toBe(
      1000
    );
    expect(outcome.stamps.get(config.electorateName)).toBe(STAMP);
  });

  test('a seat republished with identical content hashes to the same payload', async () => {
    // The stamps moved, so the transport says "changed", but nothing a reader
    // would see did: the cycle must not look like a new count.
    const source = conditionalSource(async () => ({
      status: 'modified',
      results: SEAT,
      lastModified: STAMP,
    }));

    const first = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map(),
    });
    const second = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map([
        [config.electorateName, 'Thu, 05 Nov 2026 09:00:00 GMT'],
      ]),
    });

    expect(second.stamps.get(config.electorateName)).toBe(STAMP);
    expect(second.signature).toBe(first.signature);
  });

  test('a moved vote changes the signature even when the stamp repeats', async () => {
    // The case stamps alone cannot see: a source that rewrites a file without
    // moving `Last-Modified`. The published facts still changed, so the cycle
    // must publish.
    const at = (votes: number) => ({
      ...SEAT,
      candidateVotes: [{ candidate: 'Alice', votes, party: 'Red Party' }],
      partyVotes: [{ candidate: 'Red Party', votes }],
      votesCounted: votes,
    });

    const cycle = async (votes: number) => {
      const source = conditionalSource(async () => ({
        status: 'modified',
        results: at(votes),
        lastModified: STAMP,
      }));
      return scrapeCycle({
        source,
        configs: [config],
        partyListRecords: [],
        concurrency: 1,
        previousStamps: new Map([[config.electorateName, STAMP]]),
      });
    };

    const before = await cycle(1000);
    const after = await cycle(1005);

    expect(before.stamps.get(config.electorateName)).toBe(STAMP);
    expect(after.stamps.get(config.electorateName)).toBe(STAMP);
    expect(after.signature).not.toBe(before.signature);
  });

  test('the signature ignores the publish stamp itself', async () => {
    // `updatedAt` changes whenever the Commission republishes; it is not a
    // count, so it must not be able to trigger a publish on its own.
    const outcome = await scrapeCycle({
      source: conditionalSource(async () => ({
        status: 'modified',
        results: SEAT,
        lastModified: STAMP,
      })),
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map(),
    });

    expect(outcome.payload.electorateResults[0].updatedAt).toBe(
      new Date(STAMP).toISOString()
    );

    const withoutStamp = await scrapeCycle({
      source: conditionalSource(async () => ({
        status: 'modified',
        results: SEAT,
        lastModified: null,
      })),
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map(),
    });

    expect(withoutStamp.payload.electorateResults[0].updatedAt).toBeUndefined();
    expect(withoutStamp.signature).toBe(outcome.signature);
  });

  test('stamps each seat with its own publish time', async () => {
    // The page reads this to print "17 min ago" for a seat that has not moved
    // while other seats have.
    const source = conditionalSource(async () => ({
      status: 'modified',
      results: SEAT,
      lastModified: STAMP,
    }));

    const outcome = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map(),
    });

    expect(outcome.payload.electorateResults[0].updatedAt).toBe(
      new Date(STAMP).toISOString()
    );
  });

  test('a seat with no stamp is fetched unconditionally and fabricates nothing', async () => {
    // No stamp means nothing to ask about — a first cycle, a restart, or a seat
    // that never answered. It must fetch, and it must not invent a stamp that
    // would make the next cycle skip a seat we have not actually read.
    const fetchResults = vi.fn().mockResolvedValue(SEAT);
    const source = conditionalSource(
      async () => ({
        status: 'modified',
        results: SEAT,
        lastModified: null,
      }),
      fetchResults
    );

    const outcome = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map(),
    });

    expect(outcome.counts.fresh).toBe(1);
    expect(outcome.stamps.has(config.electorateName)).toBe(false);
  });

  test('a 304 with nothing cached refetches instead of publishing a hole', async () => {
    // A stamp describing data we have never held must not drop the seat from
    // the payload: a payload missing an electorate takes it off every page and
    // records the drop in history. Ask again without the header instead.
    const calls: (string | undefined)[] = [];
    const source = conditionalSource(async (_config, since) => {
      calls.push(since);
      return since
        ? { status: 'not-modified', lastModified: STAMP }
        : { status: 'modified', results: SEAT, lastModified: STAMP };
    });

    const outcome = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map([[config.electorateName, STAMP]]),
    });

    expect(calls).toEqual([STAMP, undefined]);
    expect(outcome.counts.fresh).toBe(1);
    expect(outcome.payload.electorateResults).toHaveLength(1);
    expect(outcome.stamps.get(config.electorateName)).toBe(STAMP);
  });

  test('drops the stamp when not-modified survives the unconditional re-ask', async () => {
    // Last resort: a source that answers 304 twice has nothing to give. Forget
    // the stamp so the next cycle asks fresh, and do not claim the seat.
    const source = conditionalSource(async () => ({
      status: 'not-modified',
      lastModified: STAMP,
    }));

    const outcome = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map([[config.electorateName, STAMP]]),
    });

    expect(outcome.stamps.has(config.electorateName)).toBe(false);
    expect(outcome.payload.electorateResults).toHaveLength(0);
    expect(outcome.counts.failed).toBe(1);
  });

  test('drops stamps for seats that are no longer in the cycle', async () => {
    const source = conditionalSource(async () => ({
      status: 'modified',
      results: SEAT,
      lastModified: STAMP,
    }));

    const outcome = await scrapeCycle({
      source,
      configs: [config],
      partyListRecords: [],
      concurrency: 1,
      previousStamps: new Map([
        [config.electorateName, STAMP],
        ['Abolished Seat', 'Thu, 05 Nov 2026 09:00:00 GMT'],
      ]),
    });

    expect(outcome.stamps.has('Abolished Seat')).toBe(false);
    expect(outcome.stamps.get(config.electorateName)).toBe(STAMP);
  });
});
