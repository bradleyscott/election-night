import { describe, it, expect } from 'vitest';
import type { ComparableResult } from '@election-night/core/diff';
import { buildFeedEvents } from '../../server/feed-events.js';

function makeResult(
  overrides: Partial<ComparableResult> & { electorateName: string }
): ComparableResult {
  return {
    votesCounted: 1000,
    votePercentageCounted: 0.5,
    marginOfError: 0.02,
    partyVotes: [],
    candidateVotes: [],
    leaders: {
      leadingCandidate: 'Alice',
      leadingCandidateParty: 'A',
      secondCandidate: 'Bob',
      secondCandidateParty: 'B',
      margin: 100,
      marginPercent: 0.05,
      predictionStatus: 'too-close',
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
    const first = makeResult({ electorateName: 'Testville', votesCounted: 1000 });
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
