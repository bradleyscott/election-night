import { describe, it, expect } from 'vitest';
import type { ComparableResult } from '@election-night/core/diff';
import type { SeatChance } from '@election-night/core/seat-probability';
import { buildFeedEvents } from '../../server/feed-events.js';

function makeResult(
  overrides: Partial<ComparableResult> & { electorateName: string }
): ComparableResult {
  return {
    votesCounted: 1000,
    votePercentageCounted: 0.5,
    partyVotes: [],
    candidateVotes: [],
    leaders: {
      leadingCandidate: 'Alice',
      leadingCandidateParty: 'A',
      secondCandidate: 'Bob',
      secondCandidateParty: 'B',
      margin: 100,
      marginPercent: 0.05,
    },
    ...overrides,
  } as ComparableResult;
}

describe('buildFeedEvents', () => {
  it('does not generate feed events on the first scrape', () => {
    const result = makeResult({ electorateName: 'Testville' });
    const events = buildFeedEvents([], [result]);
    expect(events).toEqual([]);
  });

  it('generates an event when vote counts change after the first scrape', () => {
    const first = makeResult({
      electorateName: 'Testville',
      votesCounted: 1000,
    });
    const second = makeResult({
      electorateName: 'Testville',
      votesCounted: 2000,
      votePercentageCounted: 0.75,
    });

    // Baseline scrape generates nothing.
    expect(buildFeedEvents([], [first])).toEqual([]);

    // Second scrape generates a result_updated event.
    const events = buildFeedEvents([first], [second]);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('result_updated');
    expect(events[0]!.electorateName).toBe('Testville');
  });
});

type CountingChance = Extract<SeatChance, { state: 'counting' }>;

function countingChance(
  overrides: Partial<CountingChance> = {}
): CountingChance {
  return {
    state: 'counting',
    othersProbability: 0.01,
    leader: { name: 'Alice', party: 'A', votes: 5100 },
    runnerUp: { name: 'Bob', party: 'B', votes: 4900 },
    probability: 0.91,
    margin: 200,
    remainingVotes: 3000,
    remainingLow: 2400,
    remainingHigh: 3600,
    progress: 0.6,
    enrolment: 45000,
    assumedCycle: false,
    insideOutstanding: true,
    specialsOutstanding: 7300,
    insideSpecials: true,
    provisionalPrior: false,
    ...overrides,
  };
}

describe('buildFeedEvents with a chance lookup', () => {
  const first = makeResult({ electorateName: 'Testville', votesCounted: 1000 });
  const second = makeResult({
    electorateName: 'Testville',
    votesCounted: 4000,
    votePercentageCounted: 0.6,
  });

  // The previous count is looked up too, so the threshold is crossed between
  // two counts rather than being read off the current one alone.
  const crossing = (result: ComparableResult) =>
    countingChance({
      probability: result.votesCounted === 4000 ? 0.91 : 0.55,
    });

  it('calls a seat once the chance of winning reaches the threshold', () => {
    const events = buildFeedEvents([first], [second], crossing);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('prediction_called');
    expect(events[0]!.summary).toContain('likely to win');
    expect(events[0]!.summary).toContain('91% chance');
    expect(events[0]!.probability).toBeCloseTo(0.91);
  });

  it('never mentions a margin of error', () => {
    const events = buildFeedEvents([first], [second], crossing);
    const text = `${events[0]!.summary} ${events[0]!.commentary}`;
    expect(text).not.toMatch(/MoE|margin of error|±/i);
  });

  it('does not call a seat below the threshold and says it is too close', () => {
    const events = buildFeedEvents([first], [second], () =>
      countingChance({ probability: 0.72 })
    );

    expect(events[0]!.type).toBe('result_updated');
    expect(events[0]!.summary).not.toContain('likely to win');
    expect(events[0]!.summary).toContain('chance');
  });

  it('publishes a withdrawal when a called seat falls back below the threshold', () => {
    const events = buildFeedEvents([first], [second], (result) =>
      countingChance({
        probability: result.votesCounted === 4000 ? 0.62 : 0.91,
      })
    );

    expect(events[0]!.type).toBe('prediction_called');
    expect(events[0]!.summary).toContain('fallen to');
  });

  it('states a finished count as a margin, never a probability', () => {
    const complete = makeResult({
      electorateName: 'Testville',
      votesCounted: 9000,
      votePercentageCounted: 1,
    });
    const events = buildFeedEvents([second], [complete], () => ({
      state: 'complete' as const,
      margin: 396,
      leader: { name: 'Alice', party: 'A', votes: 5000 },
      runnerUp: { name: 'Bob', party: 'B', votes: 4604 },
      specialsOutstanding: 1200,
    }));

    expect(events[0]!.type).toBe('count_completed');
    expect(events[0]!.probability).toBeNull();
    expect(events[0]!.summary).toContain('all ordinary votes counted');
    expect(events[0]!.commentary).toContain('Special votes');
  });
});
