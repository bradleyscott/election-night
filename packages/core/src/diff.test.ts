import { describe, expect, it } from 'vitest';
import {
  computeDiff,
  determineFeedEventType,
  determineWebhookEvents,
  diffFacts,
} from './diff.js';
import type { ComparableResult } from './diff.js';
import type { PredictionStatus } from './types.js';

function makeResult(
  overrides: Partial<ComparableResult> = {}
): ComparableResult {
  return {
    electorateName: 'Test Central',
    partyVotes: [],
    candidateVotes: [],
    votesCounted: 1000,
    votePercentageCounted: 0.5,
    marginOfError: 0.02,
    leaders: {
      leadingCandidate: 'Alice',
      leadingCandidateParty: 'Red Party',
      secondCandidate: 'Bob',
      secondCandidateParty: 'Blue Party',
      margin: 100,
      marginPercent: 0.1,
      predictionStatus: 'too-close',
    },
    ...overrides,
  };
}

describe('computeDiff', () => {
  it('produces a null-based diff with no previous result', () => {
    const diff = computeDiff(undefined, makeResult());
    expect(diff.previousVotesCounted).toBeNull();
    expect(diff.leaderChanged).toBe(false);
    expect(diff.previousLeaderName).toBeNull();
  });

  it('flags leader change and exposes the outgoing leader', () => {
    const previous = makeResult();
    const current = makeResult({
      leaders: {
        ...previous.leaders,
        leadingCandidate: 'Bob',
        leadingCandidateParty: 'Blue Party',
      },
    });
    const diff = computeDiff(previous, current);
    expect(diff.leaderChanged).toBe(true);
    expect(diff.previousLeaderName).toBe('Alice');
    expect(diff.previousLeaderParty).toBe('Red Party');
  });

  it('leaves previous leader null when the leader did not change', () => {
    const previous = makeResult();
    const diff = computeDiff(previous, makeResult({ votesCounted: 2000 }));
    expect(diff.leaderChanged).toBe(false);
    expect(diff.previousLeaderName).toBeNull();
    expect(diff.previousLeaderParty).toBeNull();
  });
});

describe('diffFacts', () => {
  it('detects count completion crossing 100%', () => {
    const previous = makeResult({ votePercentageCounted: 0.9 });
    const current = makeResult({ votePercentageCounted: 1 });
    expect(diffFacts(computeDiff(previous, current)).countCompleted).toBe(true);
  });

  it('does not treat a first result as a count completion', () => {
    const current = makeResult({ votePercentageCounted: 1 });
    expect(diffFacts(computeDiff(null, current)).countCompleted).toBe(false);
  });
});

describe('determineWebhookEvents', () => {
  it('emits nothing on the first result (baseline only)', () => {
    expect(determineWebhookEvents(computeDiff(null, makeResult()))).toEqual([]);
  });

  it('emits result_updated when votes move', () => {
    const previous = makeResult();
    const current = makeResult({ votesCounted: 1200 });
    expect(determineWebhookEvents(computeDiff(previous, current))).toEqual([
      'result_updated',
    ]);
  });

  it('emits all matching events when everything changes at once', () => {
    const previous = makeResult({ votePercentageCounted: 0.9 });
    const current = makeResult({
      votesCounted: 2000,
      votePercentageCounted: 1,
      leaders: {
        ...previous.leaders,
        leadingCandidate: 'Bob',
        leadingCandidateParty: 'Blue Party',
        predictionStatus: 'likely' as PredictionStatus,
      },
    });
    const events = determineWebhookEvents(computeDiff(previous, current));
    expect(events).toContain('result_updated');
    expect(events).toContain('prediction_changed');
    expect(events).toContain('leader_change');
    expect(events).toContain('count_completed');
  });
});

describe('determineFeedEventType', () => {
  it('prioritises leader_change over count_completed', () => {
    const previous = makeResult({ votePercentageCounted: 0.9 });
    const current = makeResult({
      votePercentageCounted: 1,
      leaders: {
        ...previous.leaders,
        leadingCandidateParty: 'Blue Party',
      },
    });
    expect(determineFeedEventType(computeDiff(previous, current))).toBe(
      'leader_change'
    );
  });

  it('returns prediction_called only when the call hardens', () => {
    const previous = makeResult();
    const current = makeResult({
      leaders: { ...previous.leaders, predictionStatus: 'likely' },
    });
    expect(determineFeedEventType(computeDiff(previous, current))).toBe(
      'prediction_called'
    );

    const softened = makeResult({
      leaders: { ...previous.leaders, predictionStatus: 'leaning' },
    });
    expect(determineFeedEventType(computeDiff(previous, softened))).toBe(
      'result_updated'
    );
  });
});
