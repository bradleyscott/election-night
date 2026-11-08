/**
 * One shared summary of what a count is, independent of any candidate's
 * probability.
 *
 * The dashboard used to derive "counted", "remaining" and "complete" in
 * several places (`countProgress`, the seat band, persisted history) with
 * slightly different inputs. This module is the one answer: counted facts,
 * contributing-place coverage, in-seat booth coverage, ordinary progress and
 * the special-vote estimate, each with its provenance and version.
 *
 * Deliberate separations:
 *
 * - a missing place count is `null`, never zero;
 * - the contributing place set (which counts towards the seat) is not the
 *   in-seat booth set (which the map draws);
 * - an estimate is not a counted fact, and no estimate is authoritative
 *   completion;
 * - the feed's `final` flag is ignored unless a caller says its semantics have
 *   been validated for this cycle, so `unknown` stays an honest phase.
 */

import {
  cycleConstantsFor,
  isCountComplete,
  nightRemaining,
  type CycleConstants,
  type SeatChance,
} from './seat-probability.js';

/** Shape version of this summary; stored with history and estimates. */
export const COUNT_SUMMARY_VERSION = 1;

export type CountPhase =
  'counting' | 'preliminary-complete' | 'official' | 'unknown';

export type CountFacts = {
  /** Votes counted exactly as the source reported them (`total_votes_cast`). */
  votesCounted: number;
  /** Sum of the candidate-vote rows. */
  candidateVotes: number;
  /** Sum of the party-vote rows. */
  partyVotes: number;
  /**
   * candidateVotes − partyVotes. A reconciliation case, not a correction: the
   * two contests are different and a national preliminary result may differ
   * from a sum of seats for reasons the feed does not publish.
   */
  candidatePartyDifference: number;
};

export type PlaceCoverage = {
  /** Contributing places whose results have arrived, when known. */
  contributingReported: number | null;
  /** Contributing places due, when known. */
  contributingTotal: number | null;
  /** Reported ÷ due for the contributing set, 0–1, or null when unknown. */
  contributingFraction: number | null;
  /** Booths standing inside this electorate that have reported, when known. */
  inSeatBoothsReported: number | null;
  /** Booths standing inside this electorate that are due, when known. */
  inSeatBoothsTotal: number | null;
  /** In-seat booths reported ÷ due, 0–1, or null when unknown. */
  inSeatBoothsFraction: number | null;
};

export type CountEstimate = {
  value: number;
  low: number;
  high: number;
  /** What produced the number, in a form a reader or audit can inspect. */
  provenance: string;
  /** Version of the basis, stored with history points. */
  version: number;
};

export type OrdinaryCount = {
  state: 'counting' | 'complete' | 'unknown';
  /** Counted ordinary votes (the feed's total). */
  counted: number;
  /** Estimated ordinary votes still to come tonight; null when unknown. */
  remaining: CountEstimate | null;
  /** Counted ÷ (counted + estimate), 0–1, or null when unknown. */
  progress: number | null;
};

export type SpecialsCount = {
  /** Estimated special votes still to be added after the night. */
  remaining: CountEstimate | null;
};

export type CountSummary = {
  /** The seat is won on the candidate vote; both sums are still recorded. */
  contest: 'candidate' | 'party';
  facts: CountFacts;
  places: PlaceCoverage;
  ordinary: OrdinaryCount;
  specials: SpecialsCount;
  phase: CountPhase;
  version: number;
};

export type CountSummaryInput = {
  result: {
    votesCounted: number;
    candidateVotes?: { votes: number }[];
    partyVotes?: { votes: number }[];
    /** The feed's `percent_voting_places_counted`, as a fraction. */
    votePercentageCounted?: number | null;
    /** Turnout so far, as a fraction. */
    percentVotesCast?: number | null;
    /** The seat file's `final` attribute, when a source exposes it. */
    final?: boolean | null;
  };
  /** The seat's model result, when one was computed. */
  chance?: SeatChance | null;
  /** Enrolled electors, when known. */
  enrolment?: number | null;
  electionYear?: number | null;
  /** Overrides the cycle lookup, mostly for tests. */
  cycle?: CycleConstants;
  /**
   * The set that counts towards this seat, when the collector answered. Its
   * `total` may exceed the in-seat booths: advance hubs elsewhere count here.
   */
  contributingPlaces?: { counted: number; total: number } | null;
  /** Booths standing inside this electorate, as the map draws them. */
  inSeatBooths?: { counted: number; total: number } | null;
  /**
   * Only `'validated'` lets `result.final` assign an official phase. Today no
   * caller can honestly claim that, so the default leaves the phase unknown
   * or preliminary-complete.
   */
  finalSemantics?: 'validated' | 'unknown';
};

function sum(votes: { votes: number }[] | undefined): number {
  return (votes ?? []).reduce((total, row) => total + (row.votes || 0), 0);
}

function fractionOf(
  counted: number | null | undefined,
  total: number | null | undefined
): number | null {
  if (counted == null || total == null || total <= 0) return null;
  return Math.min(1, Math.max(0, counted / total));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function ordinaryFromChance(chance: SeatChance): OrdinaryCount {
  if (chance.state === 'complete') {
    return {
      state: 'complete',
      counted:
        // `complete` does not carry the counted total; the caller fills it.
        0,
      remaining: {
        value: 0,
        low: 0,
        high: 0,
        provenance: 'ordinary count complete',
        version: COUNT_SUMMARY_VERSION,
      },
      progress: 1,
    };
  }
  if (chance.state === 'counting') {
    return {
      state: 'counting',
      counted: 0,
      remaining: {
        value: chance.remainingVotes,
        low: chance.remainingLow,
        high: chance.remainingHigh,
        provenance:
          'turnout × cycle night share, floored by contributing places',
        version: COUNT_SUMMARY_VERSION,
      },
      progress: clamp01(chance.progress),
    };
  }
  return { state: 'unknown', counted: 0, remaining: null, progress: null };
}

/** Build the one summary every surface reads. */
export function summarizeCount(input: CountSummaryInput): CountSummary {
  const result = input.result;
  const counted = result.votesCounted || 0;
  const candidateVotes = sum(result.candidateVotes);
  const partyVotes = sum(result.partyVotes);
  const cycle = input.cycle ?? cycleConstantsFor(input.electionYear);

  const sourceFraction =
    result.votePercentageCounted != null &&
    Number.isFinite(result.votePercentageCounted)
      ? clamp01(result.votePercentageCounted)
      : null;

  const contributing = input.contributingPlaces ?? null;
  const booths = input.inSeatBooths ?? null;

  const places: PlaceCoverage = {
    contributingReported: contributing?.counted ?? null,
    contributingTotal: contributing?.total ?? null,
    contributingFraction:
      fractionOf(contributing?.counted, contributing?.total) ?? sourceFraction,
    inSeatBoothsReported: booths?.counted ?? null,
    inSeatBoothsTotal: booths?.total ?? null,
    inSeatBoothsFraction: fractionOf(booths?.counted, booths?.total),
  };

  // The model's own answer is authoritative when it has one. Without it, the
  // same `nightRemaining` the model uses is applied directly, so the page and
  // the vacancy copy cannot invent a second estimate.
  const chance = input.chance ?? null;
  let ordinary: OrdinaryCount;
  if (chance && chance.state !== 'waiting') {
    ordinary = ordinaryFromChance(chance);
    ordinary.counted = counted;
  } else if (sourceFraction != null && isCountComplete(sourceFraction)) {
    // Every place has reported: a fact about a closed set, independent of
    // whether an enrolment figure is available.
    ordinary = {
      state: 'complete',
      counted,
      remaining: {
        value: 0,
        low: 0,
        high: 0,
        provenance: 'every contributing place reported',
        version: COUNT_SUMMARY_VERSION,
      },
      progress: 1,
    };
  } else if (counted > 0 && input.enrolment && input.enrolment > 0) {
    const night = nightRemaining({
      votesCounted: counted,
      enrolment: input.enrolment,
      cycle,
      placesCounted: sourceFraction ?? undefined,
    });
    const remaining = night.complete ? 0 : night.remainingVotes;
    ordinary = {
      state: night.complete
        ? 'complete'
        : night.progress > 0
          ? 'counting'
          : 'unknown',
      counted,
      remaining: {
        value: remaining,
        low: remaining * 0.88,
        high: remaining * 1.12,
        provenance:
          'turnout × cycle night share, floored by contributing places',
        version: COUNT_SUMMARY_VERSION,
      },
      progress: night.complete ? 1 : night.progress,
    };
  } else {
    ordinary = {
      state: 'unknown',
      counted,
      remaining: null,
      progress: null,
    };
  }

  let specialsValue: number | null = null;
  if (chance && chance.state !== 'waiting') {
    specialsValue = chance.specialsOutstanding;
  } else if (input.enrolment && input.enrolment > 0) {
    specialsValue = input.enrolment * cycle.turnout * cycle.specialShare;
  }
  const specials: SpecialsCount = {
    remaining:
      specialsValue == null
        ? null
        : {
            value: specialsValue,
            low: specialsValue,
            high: specialsValue,
            provenance: 'enrolment × cycle turnout × national special share',
            version: COUNT_SUMMARY_VERSION,
          },
  };

  const validated = input.finalSemantics === 'validated';
  const official = validated && result.final === true;
  if (official) {
    // An official result is not a forecast: nothing is outstanding, specials
    // included, and the estimate slots must not invent them.
    ordinary = {
      state: 'complete',
      counted,
      remaining: {
        value: 0,
        low: 0,
        high: 0,
        provenance: 'official result',
        version: COUNT_SUMMARY_VERSION,
      },
      progress: 1,
    };
    specials.remaining = null;
  }

  const phase: CountPhase = validated
    ? result.final === true
      ? 'official'
      : ordinary.state === 'complete'
        ? 'preliminary-complete'
        : counted > 0
          ? 'counting'
          : 'unknown'
    : ordinary.state === 'complete'
      ? 'preliminary-complete'
      : counted > 0
        ? 'counting'
        : 'unknown';

  return {
    contest: 'candidate',
    facts: {
      votesCounted: counted,
      candidateVotes,
      partyVotes,
      candidatePartyDifference: candidateVotes - partyVotes,
    },
    places,
    ordinary,
    specials,
    phase,
    version: COUNT_SUMMARY_VERSION,
  };
}

/**
 * National ordinary progress over a set of seats, using the same summary.
 *
 * A seat with an unknown denominator contributes its counted votes and no
 * expected remainder; the result is then a share of what is known, and the
 * caller can tell from `unknownSeats` that it is not a complete national
 * percentage.
 */
export function summarizeNationalCount(seats: CountSummaryInput[]): {
  votesCounted: number;
  expected: number;
  fraction: number | null;
  unknownSeats: number;
} {
  let votesCounted = 0;
  let expected = 0;
  let unknownSeats = 0;

  for (const input of seats) {
    const summary = summarizeCount(input);
    if (summary.ordinary.counted <= 0) continue;
    votesCounted += summary.ordinary.counted;
    if (summary.ordinary.remaining === null) {
      unknownSeats += 1;
      expected += summary.ordinary.counted;
      continue;
    }
    expected += summary.ordinary.counted + summary.ordinary.remaining.value;
  }

  return {
    votesCounted,
    expected,
    fraction: expected > 0 ? Math.min(1, votesCounted / expected) : null,
    unknownSeats,
  };
}
