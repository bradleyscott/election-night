import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ElectorateResult } from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';

const mockConfig: {
  resultsCachePath: string;
  electionYear: string;
} = {
  resultsCachePath: '',
  electionYear: '2026',
};

vi.mock('./config.js', () => ({
  collectorConfig: mockConfig,
}));

function makeResult(
  overrides: Partial<ElectorateResult> = {}
): ElectorateResult {
  return {
    electorateName: 'Test Electorate',
    partyVotes: [],
    candidateVotes: [],
    votesCounted: 10000,
    votePercentageCounted: 0.8,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 400,
      marginPercent: 0.04,
    },
    ...overrides,
  };
}

function countingChance(probability: number): SeatChance {
  return {
    state: 'counting',
    probability,
    // The seat is worth less than tonight's count alone, because the specials
    // can still take it; the pair is ordered, not equal.
    countProbability: Math.min(1, probability + 0.04),
    specialsProbability: Math.min(1, probability + 0.02),
    othersProbability: 0,
    leader: { name: 'Smith, John', party: 'National Party', votes: 5100 },
    runnerUp: { name: 'Jones, Mary', party: 'Labour Party', votes: 4900 },
    margin: 200,
    remainingVotes: 3000,
    remainingLow: 2400,
    remainingHigh: 3600,
    progress: 0.6,
    enrolment: 45000,
    assumedCycle: false,
    insideOutstanding: true,
    specialsOutstanding: 7300,
    specialsRequiredSwing: 200 / 7300,
    insideSpecials: true,
    provisionalPrior: false,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'election-night-test-'));
  mockConfig.resultsCachePath = join(tmpDir, 'results.json');
  mockConfig.electionYear = '2026';
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('cacheResults', () => {
  test('writes a cycle-tagged cache to disk', async () => {
    const { cacheResults } = await import('./results.js');
    cacheResults([makeResult({ electorateName: 'Test' })]);

    expect(existsSync(mockConfig.resultsCachePath)).toBe(true);
    const written = JSON.parse(
      readFileSync(mockConfig.resultsCachePath, 'utf-8')
    );
    expect(written.electionYear).toBe('2026');
    expect(written.results).toHaveLength(1);
    expect(written.results[0].electorateName).toBe('Test');
  });

  test('overwrites the previous cache', async () => {
    const { cacheResults } = await import('./results.js');
    cacheResults([makeResult({ electorateName: 'First' })]);
    cacheResults([makeResult({ electorateName: 'Second' })]);

    const written = JSON.parse(
      readFileSync(mockConfig.resultsCachePath, 'utf-8')
    );
    expect(written.results).toHaveLength(1);
    expect(written.results[0].electorateName).toBe('Second');
  });
});

describe('readResults election-year guard', () => {
  /**
   * The cache is a snapshot of the current cycle, so a leftover file from the
   * previous one must not become the diff baseline — otherwise the first
   * scrape of election night fires a burst of bogus events. Each case writes
   * the file directly because `cacheResults` is memoised in module state.
   */
  const staleCases = [
    {
      name: 'a cache from a previous cycle',
      contents: JSON.stringify({
        electionYear: '2023',
        results: [makeResult({ electorateName: 'Wellington Central' })],
      }),
    },
    {
      name: 'a legacy bare-array cache with no cycle attribution',
      contents: JSON.stringify([
        makeResult({ electorateName: 'Wellington Central' }),
      ]),
    },
    {
      name: 'a corrupt cache file',
      contents: 'not json at all',
    },
  ];

  for (const { name, contents } of staleCases) {
    test(`ignores ${name}`, async () => {
      writeFileSync(mockConfig.resultsCachePath, contents);
      const { readResults } = await import('./results.js');

      expect(readResults()).toEqual([]);
    });
  }

  test('uses a cache written for the active cycle', async () => {
    writeFileSync(
      mockConfig.resultsCachePath,
      JSON.stringify({
        electionYear: '2026',
        results: [makeResult({ electorateName: 'Kenepuru' })],
      })
    );
    const { readResults } = await import('./results.js');

    expect(readResults()).toHaveLength(1);
    expect(readResults()[0]!.electorateName).toBe('Kenepuru');
  });
});

describe('buildWebhookPayloads', () => {
  const meta = { electionYear: '2026', publicationKey: 'publication-1' };

  test('produces nothing on the first scrape', async () => {
    const { buildWebhookPayloads } = await import('./results.js');

    expect(buildWebhookPayloads([makeResult()], undefined, meta)).toEqual([]);
  });

  test('announces a vote movement once', async () => {
    const { buildWebhookPayloads, cacheResults } = await import('./results.js');
    cacheResults([makeResult({ votesCounted: 5000 })]);

    const payloads = buildWebhookPayloads(
      [makeResult({ votesCounted: 10000 })],
      undefined,
      meta
    );

    expect(payloads.map((p) => p.event)).toContain('result_updated');
    expect(payloads[0]!.diff.currentVotesCounted).toBe(10000);
    expect(payloads[0]!.diff.previousVotesCounted).toBe(5000);
    // A stable id makes a retried publication deduplicable at the receiver.
    expect(payloads[0]!.eventId).toBe(
      'publication-1:result_updated:Test Electorate'
    );
  });

  test('announces a leader change with the outgoing leader', async () => {
    const { buildWebhookPayloads, cacheResults } = await import('./results.js');
    cacheResults([makeResult()]);

    const previous = makeResult();
    const payloads = buildWebhookPayloads(
      [
        makeResult({
          votesCounted: 20000,
          leaders: {
            ...previous.leaders,
            leadingCandidate: 'Jones, Mary',
            leadingCandidateParty: 'Labour Party',
          },
        }),
      ],
      undefined,
      meta
    );

    const event = payloads.find((p) => p.event === 'leader_change');
    expect(event).toBeDefined();
    expect(event!.diff.previousLeaderParty).toBe('National Party');
  });

  test('calls a seat on the chance model, not a status band', async () => {
    const { buildWebhookPayloads, cacheResults } = await import('./results.js');
    cacheResults([
      makeResult({ votesCounted: 5000, votePercentageCounted: 0.5 }),
    ]);

    // The status band does not move between these two counts; only the chance
    // crosses 0.9. The announcement has to follow the chance, because that is
    // what the feed and the electorate page are showing.
    const payloads = buildWebhookPayloads(
      [makeResult({ votesCounted: 9000, votePercentageCounted: 0.7 })],
      (result) => countingChance(result.votesCounted < 9000 ? 0.62 : 0.93),
      meta
    );

    const prediction = payloads.find((p) => p.event === 'prediction_changed');
    expect(prediction).toBeDefined();
    expect(prediction!.probability).toBeCloseTo(0.93);
    // The modelled share of tonight's vote, not the 0.7 share of voting places
    // the feed reported.
    expect(prediction!.progress).toBeCloseTo(0.6);
  });

  test('omits prediction events when no chance lookup is supplied', async () => {
    const { buildWebhookPayloads, cacheResults } = await import('./results.js');
    cacheResults([makeResult({ votesCounted: 5000 })]);

    const payloads = buildWebhookPayloads(
      [makeResult({ votesCounted: 9000 })],
      undefined,
      meta
    );

    expect(payloads.map((p) => p.event)).not.toContain('prediction_changed');
    expect(payloads.every((p) => p.probability === null)).toBe(true);
    expect(payloads.every((p) => p.progress === null)).toBe(true);
  });

  test('announces a completed count', async () => {
    const { buildWebhookPayloads, cacheResults } = await import('./results.js');
    cacheResults([
      makeResult({
        electorateName: 'Wellington Central',
        votesCounted: 30000,
        votePercentageCounted: 0.95,
      }),
    ]);

    const payloads = buildWebhookPayloads(
      [
        makeResult({
          electorateName: 'Wellington Central',
          votesCounted: 32000,
          votePercentageCounted: 1.0,
        }),
      ],
      undefined,
      meta
    );

    const events = payloads.map((p) => p.event);
    expect(events).toContain('result_updated');
    expect(events).toContain('count_completed');
  });

  test('produces nothing when the count has not moved', async () => {
    const { buildWebhookPayloads, cacheResults } = await import('./results.js');
    const result = makeResult({ electorateName: 'Dunedin' });
    cacheResults([result]);

    expect(buildWebhookPayloads([result], undefined, meta)).toEqual([]);
  });
});
