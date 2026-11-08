import { describe, expect, it } from 'vitest';
import type { ResultsEnvelope } from '@election-night/core/types';
import { classifyResultsEnvelope } from './results-envelope.js';

function envelope(overrides: Partial<ResultsEnvelope> = {}): ResultsEnvelope {
  return {
    payload: { electorateResults: [], partyVote: [], partyLists: [] },
    electionYear: '2026',
    revision: 1,
    ...overrides,
  };
}

describe('classifyResultsEnvelope', () => {
  it('accepts a newer revision in the served cycle', () => {
    expect(
      classifyResultsEnvelope(envelope({ revision: 4 }), {
        electionYear: '2026',
        latestRevision: 3,
      })
    ).toEqual({ kind: 'accept' });
  });

  it('accepts an unchanged duplicate without deriving new events', () => {
    expect(
      classifyResultsEnvelope(envelope({ revision: 3 }), {
        electionYear: '2026',
        latestRevision: 3,
      })
    ).toEqual({ kind: 'duplicate' });
  });

  it('rejects an older revision', () => {
    expect(
      classifyResultsEnvelope(envelope({ revision: 2 }), {
        electionYear: '2026',
        latestRevision: 3,
      })
    ).toMatchObject({ kind: 'reject' });
  });

  it('rejects another cycle', () => {
    expect(
      classifyResultsEnvelope(envelope({ electionYear: '2023' }), {
        electionYear: '2026',
        latestRevision: 1,
      })
    ).toMatchObject({ kind: 'reject' });
  });

  it('rejects a malformed payload', () => {
    expect(
      classifyResultsEnvelope(
        envelope({
          payload: {
            electorateResults: [],
          } as unknown as ResultsEnvelope['payload'],
        }),
        { electionYear: '2026', latestRevision: null }
      )
    ).toEqual({ kind: 'reject', reason: 'invalid payload' });
  });

  it('keeps legacy senders without a revision working', () => {
    expect(
      classifyResultsEnvelope(
        envelope({ revision: null, electionYear: null }),
        { electionYear: '2026', latestRevision: 5 }
      )
    ).toEqual({ kind: 'accept' });
  });
});
