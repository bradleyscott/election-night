import type { ElectorateDiff, FeedEvent } from '@election-night/core/types';
import {
  computeDiff,
  diffFacts,
  determineFeedEventType,
  type ComparableResult,
} from '@election-night/core/diff';

/**
 * Render the short (summary) and long (commentary) copy for one diff.
 * Both variants are produced together so the facts can never drift
 * between them.
 */
function renderCopy(
  diff: ElectorateDiff,
  result: ComparableResult
): { summary: string; commentary: string } {
  const l = result.leaders;
  const name = result.electorateName;
  const pct = (result.votePercentageCounted * 100).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const party = (p: string | null | undefined) => p ?? 'Independent';
  const moePct = (result.marginOfError * 100).toFixed(1);
  const leader = `${l.leadingCandidate} (${party(l.leadingCandidateParty)})`;

  if (diff.leaderChanged) {
    const outgoing = `${diff.previousLeaderName} (${party(diff.previousLeaderParty)})`;
    return {
      summary: `${name}: ${leader} took the lead from ${outgoing} — leads by ${marginPct}%.`,
      commentary: `${leader} has taken the lead from ${outgoing} in ${name}. The lead is ${marginPct}% with ${pct}% of votes counted.`,
    };
  }

  const facts = diffFacts(diff);
  if (facts.countCompleted) {
    return {
      summary: `${name}: ${leader} is the likely winner — ${marginPct}% lead at 100% counted.`,
      commentary: `${leader} is the likely winner in ${name} with all ordinary votes counted.`,
    };
  }

  if (diff.predictionStatusChanged && facts.predictionCalled) {
    return {
      summary: `${name}: ${leader} is the likely winner — ${marginPct}% lead exceeds ±${moePct}% MoE, making this a confident prediction at ${pct}% counted.`,
      commentary: `${leader} is the likely winner in ${name}. The ${marginPct}% lead exceeds the ±${moePct}% margin of error, making this a confident prediction at ${pct}% counted.`,
    };
  }

  if (diff.predictionStatusChanged && l.predictionStatus === 'leaning') {
    return {
      summary: `${name}: ${leader} is ahead by ${marginPct}% — but the ±${moePct}% MoE means the race is still too close to call at ${pct}% counted.`,
      commentary: `${leader} is ahead in ${name} with ${marginPct}% of the vote. But a ±${moePct}% margin of error means the race is still too close to call at ${pct}% counted.`,
    };
  }

  if (diff.previousMargin !== null && diff.previousMarginPercent !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    if (marginDelta > 0) {
      const widenedPct = (
        (l.marginPercent - diff.previousMarginPercent) *
        100
      ).toFixed(2);
      return {
        summary: `${name}: ${leader} extended their lead by ${widenedPct}% to ${marginPct}% at ${pct}% counted.`,
        commentary: `${leader} extended their lead by ${widenedPct}% to ${marginPct}% in ${name} at ${pct}% counted.`,
      };
    }
    if (marginDelta < 0) {
      const narrowedPct = (
        (diff.previousMarginPercent - l.marginPercent) *
        100
      ).toFixed(2);
      return {
        summary: `${name}: ${leader} leads by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`,
        commentary: `${leader} leads in ${name} by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`,
      };
    }
  }

  const second = `${l.secondCandidate} (${party(l.secondCandidateParty)})`;
  return {
    summary: `${name}: ${leader} leads ${second} by ${marginPct}% at ${pct}% counted.`,
    commentary: `${leader} leads ${second} by ${marginPct}% in ${name} at ${pct}% counted.`,
  };
}

/**
 * Compare a new payload against the previous one and generate feed events
 * for every electorate where something interesting happened.
 *
 * The first scrape of an electorate just establishes a baseline and does
 * not produce a feed event, matching the core diff contract.
 */
export function buildFeedEvents(
  previous: ComparableResult[],
  current: ComparableResult[]
): FeedEvent[] {
  const events: FeedEvent[] = [];
  const prevMap = new Map(previous.map((r) => [r.electorateName, r]));

  for (const result of current) {
    const diff = computeDiff(prevMap.get(result.electorateName), result);
    const facts = diffFacts(diff);

    // First scrape just establishes a baseline; no feed events.
    if (facts.isFirstResult) continue;

    if (
      !facts.votesChanged &&
      !diff.predictionStatusChanged &&
      !diff.leaderChanged &&
      !facts.countCompleted
    )
      continue;

    const { summary, commentary } = renderCopy(diff, result);
    events.push({
      id: `${result.electorateName}-${diff.currentVotesCounted}-${Math.round(
        (diff.currentMargin ?? 0) * 100
      )}-${diff.currentPredictionStatus ?? 'none'}`,
      timestamp: Date.now(),
      type: determineFeedEventType(diff),
      electorateName: result.electorateName,
      predictionStatus: result.leaders.predictionStatus,
      marginOfError: result.marginOfError,
      summary,
      commentary,
      diff,
    });
  }

  return events;
}
