import type { ResultsPayload } from '@election-night/core/types';

/**
 * Whether any vote has been counted yet.
 *
 * `results` being non-null does not mean there is a result. The feed publishes
 * the whole ballot before election day — every seat, every candidate, every
 * party list — with every count zeroed, and the collector passes that payload
 * through because the map and the candidate list need it. So a page that reads
 * only the count would otherwise open on election morning as a strip of zeros:
 * 0 seats, 0 parties in parliament, 0 votes counted and a dash for the share,
 * with every list candidate 1 to 72 places below their party's cut. Those are
 * not small results, they are the absence of one told in the vocabulary of
 * results, and a reader cannot tell the two apart.
 *
 * A page whose every figure is derived from the count therefore asks this
 * question and shows the count's own pending state until it answers true — the
 * same tally the Feed and Trends pages show, so the site has one way of saying
 * "waiting" rather than four. The pages that carry the ballot as well as the
 * count keep rendering it: the ballot is published, not pending.
 */
export function hasCounted(
  results: ResultsPayload | null | undefined
): boolean {
  if (!results) return false;

  return (
    results.electorateResults.some((seat) => seat.votesCounted > 0) ||
    results.partyVote.some((party) => party.votes > 0)
  );
}
