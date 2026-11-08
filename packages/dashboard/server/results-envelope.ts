import type { ResultsEnvelope } from '@election-night/core/types';

export type EnvelopeDecision =
  | { kind: 'accept' }
  | { kind: 'duplicate' }
  | { kind: 'reject'; reason: string };

/**
 * Decide what to do with a published results envelope.
 *
 * - A malformed payload is rejected.
 * - A named cycle that is not the one being served is rejected.
 * - Within one cycle, a lower revision is rejected and an equal revision is
 *   accepted as a duplicate (acknowledged, but no second broadcast or feed
 *   events). A null revision keeps legacy senders working.
 */
export function classifyResultsEnvelope(
  envelope: ResultsEnvelope,
  options: {
    electionYear?: string | null;
    latestRevision: number | null;
  }
): EnvelopeDecision {
  const payload = envelope.payload;
  if (
    !payload ||
    !Array.isArray(payload.electorateResults) ||
    !Array.isArray(payload.partyVote) ||
    !Array.isArray(payload.partyLists)
  ) {
    return { kind: 'reject', reason: 'invalid payload' };
  }

  if (
    envelope.electionYear &&
    options.electionYear &&
    envelope.electionYear !== options.electionYear
  ) {
    return {
      kind: 'reject',
      reason: `wrong cycle ${envelope.electionYear} (serving ${options.electionYear})`,
    };
  }

  if (envelope.revision !== null && options.latestRevision !== null) {
    if (envelope.revision < options.latestRevision) {
      return {
        kind: 'reject',
        reason: `older revision ${envelope.revision} (have ${options.latestRevision})`,
      };
    }
    if (envelope.revision === options.latestRevision) {
      return { kind: 'duplicate' };
    }
  }

  return { kind: 'accept' };
}
