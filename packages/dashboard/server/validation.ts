import { z } from 'zod';
import type {
  ResultsEnvelope,
  ResultsPayload,
} from '@election-night/core/types';

/**
 * Runtime boundary for a publisher's frame.
 *
 * Zod is already a dependency, so the socket boundary gets a real schema
 * rather than a chain of `Array.isArray` checks. Unknown fields are preserved:
 * an older collector may add a field, and rejecting it would turn a harmless
 * deployment skew into an outage.
 */
const electorate = z.object({ electorateName: z.string() }).passthrough();

const payloadSchema = z
  .object({
    electorateResults: z.array(electorate),
    partyVote: z.array(z.unknown()),
    partyLists: z.array(z.unknown()),
  })
  .passthrough();

const envelopeSchema = z
  .object({
    payload: payloadSchema,
    electionYear: z.string().nullable().optional(),
    revision: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

/**
 * Parse either the revisioned envelope or a legacy bare payload. Returns null
 * for anything that is not a results frame at all.
 */
export function parseResultsEnvelope(data: unknown): ResultsEnvelope | null {
  if (data && typeof data === 'object' && 'payload' in data) {
    const parsed = envelopeSchema.safeParse(data);
    if (!parsed.success) return null;
    return {
      payload: parsed.data.payload as unknown as ResultsPayload,
      electionYear: parsed.data.electionYear ?? null,
      revision: parsed.data.revision ?? null,
    };
  }

  const legacy = payloadSchema.safeParse(data);
  if (!legacy.success) return null;
  return {
    payload: legacy.data as unknown as ResultsPayload,
    electionYear: null,
    revision: null,
  };
}
