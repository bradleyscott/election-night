import type { ElectorateDiff, FeedEvent } from '@election-night/core/types';
import {
  computeDiff,
  diffFacts,
  type ComparableResult,
} from '@election-night/core/diff';
import {
  CALL_THRESHOLD,
  type SeatChance,
} from '@election-night/core/seat-probability';

/**
 * Resolve the live chance of winning for one electorate. The payload carries
 * counts and margins, not probabilities: the prior, the enrolment and the
 * cycle constants live in the dashboard, so the caller supplies the lookup and
 * this module never has to guess which cycle it is describing.
 */
export type ChanceLookup = (result: ComparableResult) => SeatChance | null;

/**
 * A seat is "called" only while it is being counted: a finished count has a
 * margin, not a probability, and is described as a fact by `countCompleted`.
 */
function isCalled(chance: SeatChance | null | undefined): boolean {
  return chance?.state === 'counting' && chance.probability >= CALL_THRESHOLD;
}

function chancePercent(
  chance: Extract<SeatChance, { state: 'counting' }>
): string {
  return `${Math.round(chance.probability * 100)}%`;
}

/**
 * The special-vote sentence for a finished count, or nothing.
 *
 * Two conditions, both of them the model's: the count has to be finished, and
 * the margin has to be inside what this seat's special vote could move. The
 * volume and the chance of surviving it are named because a reader can check
 * them; the direction is not, because the model only knows the size of the
 * special vote and not its split.
 *
 * This replaces a hardcoded `margin < 1500` test, which meant opposite things in
 * different seats: 1,500 votes is inside the special vote in Invercargill and
 * nowhere near it in Auckland Central, where 2023 delivered 12,347 of them.
 */
function describeSpecials(chance: SeatChance | null): string {
  if (!chance || chance.state === 'waiting') return '';
  if (!chance.insideSpecials) return '';
  return ` Special votes are counted after election night and about ${Math.round(
    chance.specialsOutstanding
  ).toLocaleString()} are still to be added — more than this margin, which leaves a ${Math.round(
    chance.specialsProbability * 100
  )}% chance the lead survives them.`;
}

/**
 * Render the short (summary) and long (commentary) copy for one diff.
 * Both variants are produced together so the facts can never drift
 * between them.
 *
 * Every line here describes the count in votes and in the chance of winning
 * the seat.
 */
function renderCopy(
  diff: ElectorateDiff,
  result: ComparableResult,
  chance: SeatChance | null,
  flags: { called: boolean; wasCalled: boolean }
): { summary: string; commentary: string } {
  const l = result.leaders;
  const name = result.electorateName;
  // Percent counted is votes against the votes tonight is expected to produce,
  // the same denominator the seat panel prints. `votePercentageCounted` is the
  // share of *voting places* reported, which runs hot early (advance votes land
  // in blocks after 7pm), so it is only a fallback when no cycle is modelled.
  const pct = (
    chance?.state === 'counting'
      ? chance.progress * 100
      : result.votePercentageCounted * 100
  ).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const votes = diff.currentMargin.toLocaleString();
  const party = (p: string | null | undefined) => p ?? 'Independent';
  const leader = `${l.leadingCandidate} (${party(l.leadingCandidateParty)})`;

  if (diff.leaderChanged) {
    const outgoing = `${diff.previousLeaderName} (${party(diff.previousLeaderParty)})`;
    return {
      summary: `${name}: ${leader} took the lead from ${outgoing} — leads by ${votes} votes (${marginPct}%).`,
      commentary: `${leader} has taken the lead from ${outgoing} in ${name}. They lead by ${votes} votes, ${marginPct}% of the vote counted so far, with ${pct}% of votes counted.`,
    };
  }

  const facts = diffFacts(diff);
  if (facts.countCompleted) {
    // A finished ordinary count is a fact about a count, not a claim about the
    // seat. Specials are counted weeks later, so the one thing worth saying is
    // whether they are large enough to matter — decided by the model against
    // this seat's own measured special vote, not by a threshold on the margin.
    // Which way they would move is not stated, because it is not measured.
    const specials = describeSpecials(chance);
    return {
      summary: `${name}: ${leader} leads by ${votes} votes with all ordinary votes counted.`,
      commentary: `${leader} leads by ${votes} votes in ${name} with all ordinary votes counted.${specials}`,
    };
  }

  if (chance?.state === 'counting' && flags.called && !flags.wasCalled) {
    const share = chancePercent(chance);
    return {
      summary: `${name}: ${leader} is likely to win — ${share} chance of winning with ${pct}% counted.`,
      commentary: `${leader} is likely to win ${name}. Leading by ${votes} votes with ${pct}% counted, and about ${Math.round(chance.remainingVotes).toLocaleString()} votes still to come, their chance of winning the seat is ${share}.`,
    };
  }

  if (chance?.state === 'counting' && !flags.called && flags.wasCalled) {
    const share = chancePercent(chance);
    return {
      summary: `${name}: ${leader} leads by ${votes} votes, but the chance of winning it has fallen to ${share} at ${pct}% counted.`,
      commentary: `${leader} still leads ${name} by ${votes} votes, with ${pct}% counted. Later votes have cut their chance of winning the seat to ${share}.`,
    };
  }

  if (chance?.state === 'counting') {
    // The number is the claim. No verdict adjective rides along with it: the
    // reader sees the votes, what is still to come, and the chance, and can
    // grade it themselves.
    const share = chancePercent(chance);
    return {
      summary: `${name}: ${leader} leads by ${votes} votes — ${share} chance of winning with ${pct}% counted.`,
      commentary: `${leader} leads ${name} by ${votes} votes with ${pct}% counted. About ${Math.round(chance.remainingVotes).toLocaleString()} votes are still to come, and their chance of winning the seat is ${share}.`,
    };
  }

  if (diff.previousMargin !== null && diff.previousMarginPercent !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    // The lead is quoted as a share of votes counted, so one more ballot moves
    // both halves of the fraction. A vote or two can therefore widen the count
    // while the percentage rounds to zero — "extended their lead by -0.00%" is
    // what that looks like if the two are printed without checking. Fall back
    // to the vote count when the share has not visibly moved.
    const widened = Math.abs(
      (l.marginPercent - diff.previousMarginPercent) * 100
    );
    if (marginDelta > 0) {
      const growth =
        widened < 0.005
          ? `${marginDelta.toLocaleString()} votes`
          : `${widened.toFixed(2)}%`;
      return {
        summary: `${name}: ${leader} extended their lead by ${growth} to ${marginPct}% at ${pct}% counted.`,
        commentary: `${leader} extended their lead by ${growth} to ${marginPct}% in ${name} at ${pct}% counted.`,
      };
    }
    if (marginDelta < 0) {
      const shrink =
        widened < 0.005
          ? `${Math.abs(marginDelta).toLocaleString()} votes`
          : `${widened.toFixed(2)}%`;
      return {
        summary: `${name}: ${leader} leads by ${marginPct}% at ${pct}% counted — the gap narrowed by ${shrink}.`,
        commentary: `${leader} leads in ${name} by ${marginPct}% at ${pct}% counted — the gap narrowed by ${shrink}.`,
      };
    }
  }

  const second = `${l.secondCandidate} (${party(l.secondCandidateParty)})`;
  return {
    summary: `${name}: ${leader} leads ${second} by ${votes} votes at ${pct}% counted.`,
    commentary: `${leader} leads ${second} by ${votes} votes in ${name} at ${pct}% counted.`,
  };
}

/**
 * Compare a new payload against the previous one and generate feed events
 * for every electorate where something interesting happened.
 *
 * The first scrape of an electorate just establishes a baseline and does
 * not produce a feed event, matching the core diff contract.
 *
 * `chanceFor` is optional so the diff contract stays usable without a prior —
 * the tests and any caller that has no baseline still get structural events,
 * they just lose the probability language.
 */
export function buildFeedEvents(
  previous: ComparableResult[],
  current: ComparableResult[],
  chanceFor?: ChanceLookup
): FeedEvent[] {
  const events: FeedEvent[] = [];
  const prevMap = new Map(previous.map((r) => [r.electorateName, r]));

  for (const result of current) {
    const previousResult = prevMap.get(result.electorateName);
    const diff = computeDiff(previousResult, result);
    const facts = diffFacts(diff);

    // First scrape just establishes a baseline; no feed events.
    if (facts.isFirstResult) continue;

    const chance = chanceFor?.(result) ?? null;
    const previousChance = previousResult
      ? (chanceFor?.(previousResult) ?? null)
      : null;
    const called = isCalled(chance);
    const wasCalled = isCalled(previousChance);
    const callChanged = called !== wasCalled;

    if (
      !facts.votesChanged &&
      !diff.leaderChanged &&
      !facts.countCompleted &&
      !callChanged
    )
      continue;

    const { summary, commentary } = renderCopy(diff, result, chance, {
      called,
      wasCalled,
    });

    const type = diff.leaderChanged
      ? 'leader_change'
      : facts.countCompleted
        ? 'count_completed'
        : callChanged
          ? 'prediction_called'
          : 'result_updated';

    events.push({
      // The chance, not a status word, identifies the state the event
      // describes: two events on the same count with different probabilities
      // are different claims.
      id: `${result.electorateName}-${diff.currentVotesCounted}-${Math.round(
        diff.currentMargin * 100
      )}-${chance?.state === 'counting' ? Math.round(chance.probability * 100) : (chance?.state ?? 'none')}`,
      timestamp: Date.now(),
      type,
      electorateName: result.electorateName,
      probability: chance?.state === 'counting' ? chance.probability : null,
      progress: chance?.state === 'counting' ? chance.progress : null,
      summary,
      commentary,
      diff,
    });
  }

  return events;
}
