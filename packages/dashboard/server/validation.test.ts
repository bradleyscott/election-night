import { describe, expect, it } from 'vitest';
import { parseResultsEnvelope } from './validation.js';

const payload = {
  electorateResults: [{ electorateName: 'Auckland Central' }],
  partyVote: [],
  partyLists: [],
};

describe('parseResultsEnvelope', () => {
  it('accepts a revisioned envelope and preserves unknown fields', () => {
    const parsed = parseResultsEnvelope({
      payload,
      electionYear: '2026',
      revision: 3,
      extra: true,
    });
    expect(parsed).toMatchObject({
      payload,
      electionYear: '2026',
      revision: 3,
    });
  });

  it('accepts a legacy bare payload', () => {
    expect(parseResultsEnvelope(payload)).toMatchObject({
      payload,
      electionYear: null,
      revision: null,
    });
  });

  it('rejects a malformed frame', () => {
    expect(
      parseResultsEnvelope({ payload: { electorateResults: 'not an array' } })
    ).toBeNull();
    expect(parseResultsEnvelope({ wrongdoing: true })).toBeNull();
    expect(parseResultsEnvelope(null)).toBeNull();
  });
});
