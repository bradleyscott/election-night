import { describe, test, expect, vi } from 'vitest';
import {
  ElectionResultsService,
  defaultPriorYears,
} from './election-results-service.js';
import type {
  ElectorateConfig,
  ElectionSource,
  PartyList,
  RawElectorateResults,
  ResultsPayload,
} from './types.js';

type FakeYear = {
  electorates: string[];
  /** Seats the other party wins, to make flips visible. */
  winners?: Record<string, string>;
};

function rawResult(name: string, winner?: string): RawElectorateResults {
  const winnerParty = winner ?? 'Labour Party';
  const loserParty =
    winnerParty === 'Labour Party' ? 'National Party' : 'Labour Party';
  return {
    electorateName: name,
    partyVotes: [
      { candidate: winnerParty, votes: 12_000 },
      { candidate: loserParty, votes: 9_000 },
    ],
    candidateVotes: [
      { candidate: `${name} winner`, party: winnerParty, votes: 12_000 },
      { candidate: `${name} runner-up`, party: loserParty, votes: 9_000 },
    ],
    votesCounted: 21_000,
    votePercentageCounted: 1,
  };
}

const PARTY_LIST: PartyList[] = [
  { party: 'Labour Party', candidate: 'Labour One', listRank: 1 },
  { party: 'National Party', candidate: 'National One', listRank: 1 },
];

/**
 * A connector factory over an in-memory archive. `fetches` counts every
 * electorate fetch so caching and single-flight behaviour are observable.
 */
function makeArchive(
  years: Record<string, FakeYear>,
  options: { fail?: string[] } = {}
) {
  const fetches: string[] = [];
  const failing = new Set(options.fail ?? []);
  const createSource = (year: string): ElectionSource | null => {
    const data = years[year];
    if (!data) return null;
    return {
      getName: () => `fake-${year}`,
      loadElectorates: async (): Promise<ElectorateConfig[]> =>
        data.electorates.map((name) => ({ electorateName: name, url: name })),
      loadPartyList: async () => PARTY_LIST,
      fetchResults: async (config) => {
        fetches.push(`${year}:${config.electorateName}`);
        if (failing.has(year)) {
          throw new Error(`HTTP 404 fetching ${config.electorateName}`);
        }
        return rawResult(
          config.electorateName,
          data.winners?.[config.electorateName]
        );
      },
    };
  };
  return { createSource, fetches, failing };
}

function makeService(
  years: Record<string, FakeYear>,
  options: {
    currentYear?: string;
    priorYears?: string[];
    preferredPriorYear?: string;
    fail?: string[];
  } = {}
) {
  const { createSource, fetches } = makeArchive(years, { fail: options.fail });
  const service = new ElectionResultsService({
    currentYear: options.currentYear ?? '2026',
    createSource,
    priorYears: options.priorYears ?? ['2023'],
    preferredPriorYear: options.preferredPriorYear,
    fetchPacingMs: 0,
    onLog: () => {},
  });
  return { service, fetches };
}

describe('defaultPriorYears', () => {
  test('walks back three years at a time to the first MMP election', () => {
    expect(defaultPriorYears('2026')).toEqual([
      '2023',
      '2020',
      '2017',
      '2014',
      '2011',
      '2008',
      '2005',
      '2002',
      '1999',
      '1996',
    ]);
  });
});

describe('ElectionResultsService.getResults', () => {
  test('fetches an archived cycle and marks it final', async () => {
    const { service } = makeService({
      '2023': { electorates: ['Hutt South'] },
    });

    const results = await service.getResults('2023');
    expect(results?.year).toBe('2023');
    expect(results?.final).toBe(true);
    expect(results?.electorateResults).toHaveLength(1);
    expect(results?.electorateResults[0]!.leaders.leadingCandidate).toBe(
      'Hutt South winner'
    );
  });

  test('caches a cycle, so a second request refetches nothing', async () => {
    const { service, fetches } = makeService({
      '2023': { electorates: ['Hutt South', 'Remutaka'] },
    });

    await service.getResults('2023');
    const afterFirst = fetches.length;
    await service.getResults('2023');

    expect(afterFirst).toBe(2);
    expect(fetches).toHaveLength(2);
  });

  test('shares one fetch between concurrent requests for the same year', async () => {
    const { service, fetches } = makeService({
      '2023': { electorates: ['Hutt South', 'Remutaka', 'Ōtāhuhu'] },
    });

    await Promise.all([
      service.getResults('2023'),
      service.getResults('2023'),
      service.getResults('2023'),
    ]);

    expect(fetches).toHaveLength(3);
  });

  test('serves any nominated year, not only the probed ones', async () => {
    const { service } = makeService(
      { '2014': { electorates: ['Napier'] } },
      { priorYears: ['2023'] }
    );

    const results = await service.getResults('2014');
    expect(results?.final).toBe(true);
    expect(results?.electorateResults[0]!.electorateName).toBe('Napier');
  });

  test('returns null for a year the connector cannot serve', async () => {
    const { service } = makeService({});
    expect(await service.getResults('2023')).toBeNull();
  });

  test('leaves a failed cycle alone for the retry window', async () => {
    const { service, fetches } = makeService(
      { '2023': { electorates: ['Hutt South'] } },
      { fail: ['2023'] }
    );

    expect(await service.getResults('2023')).toBeNull();
    expect(await service.getResults('2023')).toBeNull();
    // The archive said no once; page loads should not keep asking.
    expect(fetches).toHaveLength(1);
  });

  test('retries once the window has passed', async () => {
    const { createSource, fetches, failing } = makeArchive(
      { '2023': { electorates: ['Hutt South'] } },
      { fail: ['2023'] }
    );
    const service = new ElectionResultsService({
      currentYear: '2026',
      createSource,
      priorYears: ['2023'],
      fetchPacingMs: 0,
      unavailableRetryMs: 0,
      onLog: () => {},
    });

    expect(await service.getResults('2023')).toBeNull();
    failing.clear();
    expect((await service.getResults('2023'))?.final).toBe(true);
    expect(fetches).toHaveLength(2);
  });

  test('returns the live cycle from the payload the scrape loop registered', async () => {
    const { service } = makeService({});
    expect(await service.getResults('2026')).toBeNull();

    const live: ResultsPayload = {
      electorateResults: [],
      partyVote: [],
      partyLists: [],
    };
    service.setLiveResults(live);

    const results = await service.getResults('2026');
    expect(results?.final).toBe(false);
    expect(results?.year).toBe('2026');
  });
});

describe('ElectionResultsService.getPriorWinners', () => {
  test('matches prior seats to today\u2019s electorates through renames', async () => {
    const { service } = makeService(
      {
        '2026': { electorates: ['Ōtāhuhu', 'Kapiti', 'Remutaka'] },
        '2023': {
          electorates: ['Panmure-Ōtāhuhu', 'Ōtaki', 'Remutaka'],
          winners: { 'Panmure-Ōtāhuhu': 'National Party' },
        },
      },
      { priorYears: ['2023'] }
    );
    service.setCurrentElectorates(['Ōtāhuhu', 'Kapiti', 'Remutaka']);

    const prior = await service.getPriorWinners();
    expect(prior.currentYear).toBe('2026');
    expect(prior.primaryYear).toBe('2023');

    const winners = prior.years[0]!.winners;
    expect(winners.map((w) => w.electorateName)).toEqual([
      'Ōtāhuhu',
      'Remutaka',
    ]);

    // Renamed seats name the old electorate so the comparison is auditable…
    const otahuhu = winners.find((w) => w.electorateName === 'Ōtāhuhu')!;
    expect(otahuhu.priorElectorateName).toBe('Panmure-Ōtāhuhu');
    expect(otahuhu.party).toBe('National Party');

    // …a surviving name is not flagged as renamed…
    expect(
      winners.find((w) => w.electorateName === 'Remutaka')!.priorElectorateName
    ).toBeNull();

    // …and merged-away Ōtaki has no equivalent, so Kapiti has no prior holder.
    expect(winners.some((w) => w.electorateName === 'Kapiti')).toBe(false);
  });

  test('reports every resolvable cycle, newest first', async () => {
    const { service } = makeService(
      {
        '2023': { electorates: ['Remutaka'] },
        '2020': { electorates: ['Remutaka'] },
        '2017': { electorates: ['Rimutaka'] },
      },
      { priorYears: ['2023', '2020', '2017'] }
    );
    service.setCurrentElectorates(['Remutaka']);

    const prior = await service.getPriorWinners();
    expect(prior.years.map((y) => y.year)).toEqual(['2023', '2020', '2017']);
    expect(prior.primaryYear).toBe('2023');
    expect(prior.years[2]!.winners[0]!.priorElectorateName).toBe('Rimutaka');
    // 2017's Rimutaka is today's Remutaka, matched through the 2020 rename.
    expect(prior.years[0]!.winners[0]!.electorateName).toBe('Remutaka');
  });

  test('stops walking at the first cycle it cannot fetch', async () => {
    const { service, fetches } = makeService(
      {
        '2020': { electorates: ['Remutaka'] },
        '2017': { electorates: ['Rimutaka'] },
      },
      { priorYears: ['2023', '2020', '2017'], fail: ['2023'] }
    );
    service.setCurrentElectorates(['Remutaka']);

    const prior = await service.getPriorWinners();
    expect(prior.years).toEqual([]);
    expect(prior.primaryYear).toBeNull();
    // 2020 and 2017 were never probed: a gap ends the walk rather than being
    // skipped over into an older, unrelated cycle.
    expect(fetches.every((f) => f.startsWith('2023:'))).toBe(true);
  });

  test('reports no prior cycle when the connector serves only the live one', async () => {
    const { service } = makeService(
      { '2026': { electorates: ['Remutaka'] } },
      { priorYears: ['2023', '2020'] }
    );
    service.setCurrentElectorates(['Remutaka']);

    const prior = await service.getPriorWinners();
    expect(prior.years).toEqual([]);
    expect(prior.primaryYear).toBeNull();
  });

  test('prefers the configured prior year when it resolved', async () => {
    const { service } = makeService(
      {
        '2020': { electorates: ['Remutaka'] },
        '2017': { electorates: ['Rimutaka'] },
      },
      { priorYears: ['2020', '2017'], preferredPriorYear: '2017' }
    );
    service.setCurrentElectorates(['Remutaka']);

    expect((await service.getPriorWinners()).primaryYear).toBe('2017');
  });

  test('ignores a preferred prior year that did not resolve', async () => {
    const { service } = makeService(
      { '2020': { electorates: ['Remutaka'] } },
      { priorYears: ['2020'], preferredPriorYear: '2017' }
    );
    service.setCurrentElectorates(['Remutaka']);

    expect((await service.getPriorWinners()).primaryYear).toBe('2020');
  });

  test('matches nothing until the current cycle’s electorates are known', async () => {
    const { service } = makeService(
      { '2023': { electorates: ['Remutaka'] } },
      { priorYears: ['2023'] }
    );

    const prior = await service.getPriorWinners();
    expect(prior.years[0]!.winners).toEqual([]);
  });

  test('warmPriorYears retries after a failure and then caches', async () => {
    const { createSource, fetches, failing } = makeArchive(
      { '2023': { electorates: ['Remutaka'] } },
      { fail: ['2023'] }
    );
    const service = new ElectionResultsService({
      currentYear: '2026',
      createSource,
      priorYears: ['2023'],
      fetchPacingMs: 0,
      unavailableRetryMs: 0,
      onLog: () => {},
    });
    service.setCurrentElectorates(['Remutaka']);

    await service.warmPriorYears();
    expect(fetches).toHaveLength(1);

    // The archive recovers: the next warm-up picks it up without a restart.
    failing.clear();
    await service.warmPriorYears();
    expect((await service.getPriorWinners()).years[0]!.winners).toHaveLength(1);

    // And once it is in, warm-ups stop fetching.
    const settled = fetches.length;
    await service.warmPriorYears();
    expect(fetches).toHaveLength(settled);
  });
});

describe('ElectionResultsService logging', () => {
  test('reports an unserviceable year once, not on every request', async () => {
    const onLog = vi.fn();
    const service = new ElectionResultsService({
      currentYear: '2026',
      createSource: () => null,
      priorYears: ['2023'],
      fetchPacingMs: 0,
      onLog,
    });

    await service.getPriorWinners();
    await service.getPriorWinners();

    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![1]).toContain('2023');
  });
});
