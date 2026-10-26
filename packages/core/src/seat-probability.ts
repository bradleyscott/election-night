import jstat from 'jstat';
import type { ElectorateResults, VotingResults } from './types.js';

/**
 * Chance of winning a seat on election night.
 *
 * The model this replaces compared the current margin to a sampling error and
 * reported safe/unsafe: a threshold wearing a percentage's clothes, which
 * barely moves as the night goes on. This one answers the question a reader
 * actually has — *given what has been counted and what is still out there, how
 * likely is the current leader to still be ahead when tonight's count ends?*
 *
 * It is deliberately not "chance of winning the seat". Special votes are
 * counted after election night and have changed seats that looked settled, so
 * every claim here is about the preliminary count.
 *
 * The shape of the maths, in the order it is applied:
 *
 *  1. Turnout turns the count into a fraction. `percent_votes_cast` is turnout
 *     (votes counted ÷ enrolled), so enrolment is recoverable and, scaled by
 *     the prior cycle's night-end share of the vote, so is the evening's total.
 *     The votes still to come are the difference.
 *  2. The outstanding votes are split using the seat's notional prior adjusted
 *     by the national swing — uniform national swing, the psephological
 *     baseline — then partially pooled toward what the seat has actually
 *     counted so far. Thin counts trust the prior; fat counts trust the seat.
 *  3. The resulting margin has a distribution, mostly from the size of the
 *     outstanding vote and from how far seats typically stray from a uniform
 *     swing (`tau`). The probability is that distribution's mass above zero.
 *
 * Two constants are measured from the archive rather than assumed, and they
 * are the part most worth re-checking before a cycle.
 */

/**
 * Ordinary votes counted on election night, as a share of every vote
 * eventually counted. 2023: 2,244,380 preliminary ordinary votes against
 * 2,867,478 final — 0.783. 2020 gives ≈0.821, 2017 ≈0.838: specials have grown
 * every cycle (17.2% → 17.4% → 21.0%), so the night delivers less of the result
 * each time and this cannot be one number for all cycles.
 */
export const NIGHT_SHARE_OF_FINAL = 0.783;

/** Final turnout as a share of enrolled electors, 2023: 77.7%. */
export const FINAL_TURNOUT = 0.777;

/**
 * Special votes as a share of all votes, 2023: 603,257 of 2,867,478 — 21.0%.
 * Counted after election night.
 */
export const SPECIAL_SHARE = 0.21;

/**
 * What a night looked like, per cycle.
 *
 * Turnout is measured against enrolled electors and the night share against the
 * cycle's own final count, so every figure here is in the feed's own basis and
 * `total_votes_cast` reconciles with it. The three cycles differ enough to
 * matter: using 2023's `nightShare` on a 2017 night would understate the vote
 * still to come by roughly 7%, and the error goes straight into `progress`.
 */
export type CycleConstants = {
  year: number;
  /** Final turnout as a share of enrolled electors. */
  turnout: number;
  /** Votes counted on the night as a share of the cycle's final count. */
  nightShare: number;
  /** Special votes as a share of the cycle's final count. */
  specialShare: number;
  /** True when this cycle has no published figures yet and these are carried over. */
  assumed?: boolean;
};

export const CYCLE_CONSTANTS: Record<number, CycleConstants> = {
  // 2017: 2,179,668 votes counted on the night of 2,602,689 final; specials
  // 446,287 (17.2%); turnout 78.9% of 3,298,009 enrolled.
  2017: { year: 2017, turnout: 0.789, nightShare: 0.838, specialShare: 0.172 },
  // 2020: 504,625 specials (17.4%) and 16,172 ordinary votes counted after the
  // night; turnout 81.9% of 3,549,580 enrolled.
  2020: { year: 2020, turnout: 0.819, nightShare: 0.821, specialShare: 0.174 },
  // 2023: 2,244,380 on the night of 2,867,478 final; specials 603,257 (21.0%);
  // turnout 77.7% of 3,688,292 enrolled.
  2023: { year: 2023, turnout: 0.777, nightShare: 0.783, specialShare: 0.21 },
};

/** The most recent cycle with published figures — the default for a new one. */
export const LATEST_CYCLE = 2023;

/**
 * The figures to use for a cycle.
 *
 * An unseen cycle inherits the newest published night. That is the conservative
 * direction on purpose: special declarations have risen every cycle, so if this
 * one follows suit the real night total is *smaller* than assumed, the model
 * believes more is outstanding than there is, and it closes seats late rather
 * than early. The spread on the outstanding vote widens to say so.
 */
export function cycleConstantsFor(year?: number | null): CycleConstants {
  const known = year != null ? CYCLE_CONSTANTS[year] : undefined;
  if (known) return known;
  return {
    ...CYCLE_CONSTANTS[LATEST_CYCLE],
    year: year ?? LATEST_CYCLE,
    assumed: true,
  };
}

/**
 * Extra spread on the size of the outstanding vote when the cycle's turnout and
 * ordinary-vote share have not been published yet — the two inputs that set the
 * night's total, both of which move several points between elections.
 */
const ASSUMED_CYCLE_SIZE_SD = 1.6;

/**
 * How far a seat typically sits from the uniform-swing prediction, as a
 * standard deviation of vote share. `scripts/build-notional-baseline.mjs`
 * measures this from the archives and writes it into the baseline file; this
 * value is only the fallback when no measurement is available.
 */
export const DEFAULT_TAU = 0.03;

/**
 * A live count is never reported as certain. The model's own distribution can
 * reach 99.99%, and at that point rounding to 100% would claim a call the
 * count has not made.
 */
export const CERTAINTY_CEILING = 0.99;
export const CERTAINTY_FLOOR = 0.01;

/**
 * Size of the composition term, as a multiple of `tau`.
 *
 * The counted votes are not a random sample of the ones still to come: early in
 * the night they are advance votes and the remainder is booths. Measured on the
 * 2023 archive, votes cast away from home differ from votes cast inside a seat
 * by a mean absolute 7.9 pp on the final margin (2020: 4.3 pp), with the
 * direction flipping between cycles. Dividing `tau²` by sampling variance alone
 * let 2,000 counted votes outvote the prior 39 to 1. This term starts at `tau`
 * and decays to zero as the count fills.
 */
export const COMPOSITION_STRENGTH = 1;

/**
 * A seat whose prior is only party-level — no candidate from last time stood
 * again — is described less confidently still. The prior is then an
 * apportionment, not this seat's own history, and the model should not call a
 * seat on the strength of it.
 */
export const PROVISIONAL_CEILING = 0.95;

/**
 * The chance at which the feed is willing to say a candidate is likely to win.
 *
 * This is a lower bar than the published race-call standard (AP calls only when
 * the trailing candidate has no path to victory) because the claim is graded and
 * reversible: it is a statement about tonight's count, it carries the number it
 * was derived from, and a seat that falls back below the threshold produces a
 * withdrawal event rather than a silent edit. The disciplined gate — no
 * plausible path on the outstanding vote — is what turns this number into an
 * "has won".
 */
export const CALL_THRESHOLD = 0.9;

/** Relative uncertainty in the size of the outstanding vote. */
const REMAINING_SIZE_SD = 0.12;

/**
 * Below this the count is treated as the preliminary count, finished: the
 * turnout-scaled estimate says nothing is left. Not exactly 1, because the
 * estimate is not exact and a count that creeps to 0.995 trips far too late.
 */
const COMPLETE_THRESHOLD = 0.99;

export type SeatPrior = {
  /** Prior party-vote share per party, as fractions summing to ~1. */
  partyShare: Record<string, number>;
  /**
   * The party's share of the candidate vote in this seat. A candidate is an
   * avatar of their party: the person can change between cycles while the
   * party's result here means the same thing, so this is the number a
   * projection should use in preference to a candidate's own name.
   */
  partyCandidateShare?: Record<string, number>;
  /** Prior candidate-vote share per candidate name, as fractions. */
  candidateShare: Record<string, number>;
};

export type SeatChanceCandidate = {
  name: string;
  party?: string;
  votes: number;
};

export type SeatChanceInput = {
  candidates: SeatChanceCandidate[];
  /** Party-vote total counted so far (`total_votes_cast`). */
  votesCounted: number;
  /** Turnout so far as a fraction (feed `percent_votes_cast` ÷ 100). */
  percentVotesCast?: number;
  /**
   * Enrolled electors in this seat, when it is known. Preferred over
   * back-solving from `percentVotesCast`, which is published to one decimal
   * place: 200 votes at "0.4%" implies 50,000 enrolled against a true 45,407.
   */
  enrolment?: number;
  /** The cycle being counted, so the night's total uses that cycle's figures. */
  electionYear?: number | null;
  /** Overrides the cycle lookup, mostly for tests and the validation harness. */
  cycle?: CycleConstants;
  /** This seat's prior result, rebuilt on the current boundaries. */
  prior?: SeatPrior | null;
  /** Party name → national swing in share points, as fractions. */
  nationalSwing?: Record<string, number>;
  tau?: number;
  /**
   * Multiplier on the composition term (see `COMPOSITION_STRENGTH`). `1` is the
   * default; `0` reproduces the sampling-only weight, which the validation
   * harness uses to compare the two.
   */
  composition?: number;
};

export type SeatChance =
  | { state: 'waiting' }
  | {
      state: 'complete';
      /** Final margin in votes for the preliminary count. */
      margin: number;
      leader: SeatChanceCandidate;
      runnerUp: SeatChanceCandidate;
      /**
       * Special votes still to be counted. A complete night count is not a
       * result: in 2023 specials were 21% of all votes and were added over the
       * fortnight after the night, so a seat decided by a few hundred votes can
       * still change hands. Carried here because it is the only thing the panel
       * can honestly say once the count stops.
       */
      specialsOutstanding: number;
    }
  | {
      state: 'counting';
      /**
       * Chance that someone outside the top two wins — the stated remainder.
       * Leader and runner-up are reported as shares of what is left, so the
       * three add to 1.
       */
      othersProbability: number;
      leader: SeatChanceCandidate;
      runnerUp: SeatChanceCandidate;
      /** Chance the current leader is ahead when tonight's count finishes. */
      probability: number;
      /** Current margin, in votes. */
      margin: number;
      /** Estimated votes still to be counted tonight. */
      remainingVotes: number;
      remainingLow: number;
      remainingHigh: number;
      /** Share of tonight's expected votes already counted, 0–1. */
      progress: number;
      /** Enrolled electors used for the estimate. */
      enrolment: number;
      /** The cycle's turnout and night-share figures were assumed, not published. */
      assumedCycle: boolean;
      /** The current margin is smaller than the votes still out. */
      insideOutstanding: boolean;
      /** Estimated special votes still to be added after tonight. */
      specialsOutstanding: number;
      /** The margin is small enough that special votes could change the seat. */
      insideSpecials: boolean;
      /** The seat has no usable prior, so the estimate leans on this count. */
      provisionalPrior: boolean;
    };

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

function normalise(shares: Record<string, number>): Record<string, number> {
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(shares)) {
    out[key] = value / total;
  }
  return out;
}

/**
 * National swing from the seats that have both a prior and a count: for each
 * party, the vote-weighted average movement in share.
 *
 * Computed from the night's own seats rather than a published table, so it is
 * available before any national figure is meaningful, and it corrects itself
 * as the early (advance-heavy, urban) seats stop dominating the sample.
 */
export function computeObservedSwing(
  seats: {
    prior?: SeatPrior | null;
    parties: VotingResults[];
    votesCounted: number;
  }[]
): Record<string, number> {
  const weighted = new Map<string, { sum: number; weight: number }>();
  for (const seat of seats) {
    if (!seat.prior || seat.votesCounted <= 0) continue;
    const observed = new Map(
      seat.parties.map((p) => [p.candidate, p.votes / seat.votesCounted])
    );
    // The swing must be measured in the same contest it is applied to: the
    // prior's party share of the candidate vote, not its party vote.
    const priorShares = seat.prior.partyCandidateShare ?? seat.prior.partyShare;
    const parties = new Set([...observed.keys(), ...Object.keys(priorShares)]);
    for (const party of parties) {
      const delta = (observed.get(party) ?? 0) - (priorShares[party] ?? 0);
      const entry = weighted.get(party) ?? { sum: 0, weight: 0 };
      entry.sum += delta * seat.votesCounted;
      entry.weight += seat.votesCounted;
      weighted.set(party, entry);
    }
  }
  const out: Record<string, number> = {};
  for (const [party, { sum, weight }] of weighted) {
    if (weight > 0) out[party] = sum / weight;
  }
  return out;
}

/**
 * What this seat says a candidate's party should start from.
 *
 * Order of preference: the party's share of the candidate vote here (stable
 * across a change of candidate), then the candidate's own result if the party
 * figure is missing, then the party's party-vote share as a last resort. A
 * candidate who did not stand last time is not a reason to lose the prior — in
 * a projection the candidate is an avatar of the party.
 */
/**
 * A party name reduced to a key both sides of a comparison agree on.
 *
 * The archive and the live feed name parties in `parties.xml` ("National
 * Party", "ACT New Zealand", "Māori Party") while anything hand-written — the
 * mock's party table, test fixtures — says "National", "ACT", "Te Pāti Māori".
 * Same party, different string, and a lookup that misses silently returns 0,
 * which reads as a party with no support rather than a bug.
 */
export function canonicalParty(name: string | null | undefined): string {
  if (!name) return '';
  const flat = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (flat.startsWith('act')) return 'act';
  if (flat.includes('green')) return 'green';
  if (flat.startsWith('labour') || flat.startsWith('labor')) return 'labour';
  if (flat.startsWith('national')) return 'national';
  if (flat.includes('maori') || flat.includes('tepati')) return 'maori';
  if (flat.includes('first') || flat === 'nzf') return 'nzf';
  if (flat.includes('opportunit') || flat === 'top' || flat.includes('top'))
    return 'top';
  return flat.replace(/party$/, '');
}

function priorShareFor(
  prior: SeatPrior | null | undefined,
  candidate: { name: string; party?: string }
): number {
  if (!prior) return 0;
  const key = canonicalParty(candidate.party);
  const byParty = lookupShare(prior.partyCandidateShare, key);
  if (byParty > 0) return byParty;
  const personal = prior.candidateShare[candidate.name] ?? 0;
  if (personal > 0) return personal;
  return lookupShare(prior.partyShare, key);
}

function swingFor(
  swing: Record<string, number>,
  party: string | undefined
): number {
  if (!party) return 0;
  const direct = swing[party];
  if (direct !== undefined) return direct;
  const key = canonicalParty(party);
  for (const [name, value] of Object.entries(swing)) {
    if (canonicalParty(name) === key) return value;
  }
  return 0;
}

/** Party shares keyed by the feed's party name, read by the canonical key. */
function lookupShare(
  shares: Record<string, number> | undefined,
  key: string
): number {
  if (!shares || !key) return 0;
  for (const [name, share] of Object.entries(shares)) {
    if (canonicalParty(name) === key) return share;
  }
  return 0;
}

/**
 * The seat's expected share of the vote still to come, per candidate.
 *
 * Prior, moved by the national swing, then partially pooled toward what this
 * seat has actually counted. The pooling weight is `tau²` against the variance
 * of the seat's own observed share — sampling noise plus the composition gap.
 */
function expectedOutstandingShares(
  input: SeatChanceInput,
  observed: Map<string, number>,
  progress: number
): Map<string, number> {
  const tau = input.tau ?? DEFAULT_TAU;
  const strength = input.composition ?? COMPOSITION_STRENGTH;
  const composition = tau * Math.max(0, 1 - progress) * strength;
  const n = input.votesCounted;
  const prior = input.prior;
  const swing = input.nationalSwing ?? {};

  const priorExpected: Record<string, number> = {};
  for (const candidate of input.candidates) {
    const fromPrior = priorShareFor(prior, candidate);
    const moved = fromPrior + swingFor(swing, candidate.party);
    priorExpected[candidate.name] = Math.max(0, moved);
  }
  const normalisedPrior = normalise(priorExpected);

  const posterior = new Map<string, number>();
  for (const candidate of input.candidates) {
    const observedShare = observed.get(candidate.name) ?? 0;
    const samplingVariance =
      n > 0 ? (observedShare * (1 - observedShare)) / n : 1;
    const weight = prior
      ? (tau * tau) / (tau * tau + samplingVariance + composition * composition)
      : 0;
    const priorShare = normalisedPrior[candidate.name] ?? observedShare;
    posterior.set(
      candidate.name,
      Math.max(0, priorShare + weight * (observedShare - priorShare))
    );
  }

  const normalised = normalise(Object.fromEntries(posterior));
  return new Map(Object.entries(normalised));
}

/**
 * Chance the current leader is still ahead when the preliminary count ends.
 *
 * Returns `waiting` before any votes are counted and `complete` once nothing
 * is estimated to be outstanding — a finished count has a margin, not a
 * probability.
 */
export function computeSeatChance(input: SeatChanceInput): SeatChance {
  const candidates = [...input.candidates].sort((a, b) => b.votes - a.votes);
  if (candidates.length < 2 || input.votesCounted <= 0) {
    return { state: 'waiting' };
  }

  const leader = candidates[0];
  const runnerUp = candidates[1];
  const margin = leader.votes - runnerUp.votes;

  const turnout = clamp01(input.percentVotesCast ?? 0);
  // Enrolment is the denominator everything else divides by. Prefer the figure
  // carried in the baseline: back-solving it from a percentage rounded to one
  // decimal place is only sound once enough votes are in.
  const enrolment =
    input.enrolment && input.enrolment > 0
      ? input.enrolment
      : turnout > 0
        ? input.votesCounted / turnout
        : 0;
  if (enrolment <= 0) return { state: 'waiting' };

  const cycle = input.cycle ?? cycleConstantsFor(input.electionYear);
  const expectedNightVotes = enrolment * cycle.turnout * cycle.nightShare;
  const specialsOutstanding = enrolment * cycle.turnout * cycle.specialShare;

  const remainingVotes = Math.max(0, expectedNightVotes - input.votesCounted);
  const progress =
    expectedNightVotes > 0
      ? clamp01(input.votesCounted / expectedNightVotes)
      : 0;

  if (progress >= COMPLETE_THRESHOLD) {
    return { state: 'complete', margin, leader, runnerUp, specialsOutstanding };
  }

  const observed = new Map(
    candidates.map((c) => [c.name, c.votes / input.votesCounted])
  );

  // Did any of tonight's candidates stand in the prior result? Candidate names
  // do not survive a cycle reliably, so when none do the seat's prior is a
  // party-level statement and deserves less confidence than a name-matched one.
  const provisionalPrior =
    !input.prior ||
    candidates.every(
      (c) =>
        lookupShare(
          input.prior?.partyCandidateShare,
          canonicalParty(c.party)
        ) <= 0 && (input.prior?.candidateShare[c.name] ?? 0) <= 0
    );

  const outstanding = expectedOutstandingShares(
    provisionalPrior && input.prior
      ? { ...input, tau: (input.tau ?? DEFAULT_TAU) * 2 }
      : input,
    observed,
    progress
  );

  const leaderShare = outstanding.get(leader.name) ?? 0;
  const runnerUpShare = outstanding.get(runnerUp.name) ?? 0;
  const shareDifference = leaderShare - runnerUpShare;

  const mean = margin + remainingVotes * shareDifference;
  const sizeSd =
    remainingVotes *
    REMAINING_SIZE_SD *
    (cycle.assumed ? ASSUMED_CYCLE_SIZE_SD : 1);
  const samplingSd = Math.sqrt(
    Math.max(0, leaderShare * (1 - leaderShare)) / Math.max(1, remainingVotes) +
      Math.max(0, runnerUpShare * (1 - runnerUpShare)) /
        Math.max(1, remainingVotes)
  );
  const tau = input.tau ?? DEFAULT_TAU;
  const variance =
    (shareDifference * sizeSd) ** 2 +
    (remainingVotes * samplingSd) ** 2 +
    (remainingVotes * tau) ** 2;
  const sd = Math.sqrt(variance);
  const raw =
    sd > 0 ? clamp01(jstat.normal.cdf(mean / sd, 0, 1)) : mean > 0 ? 1 : 0;

  // A count that is not finished never justifies certainty. Left unclamped the
  // normal tail rounds to 100%, which reads as a call and cannot move again —
  // and a seat reported at 100% that later changes hands destroys trust in
  // every other number on the page.
  const ceiling = provisionalPrior ? PROVISIONAL_CEILING : CERTAINTY_CEILING;
  const floor = 1 - ceiling;
  const probability = Math.min(ceiling, Math.max(floor, raw));

  const remainingSd = Math.sqrt(sizeSd ** 2 + (remainingVotes * tau) ** 2);

  // The remainder: what chance does the best-placed candidate outside the top
  // two have? Without it a three-way seat reports a two-way race and one of the
  // two numbers is simply wrong.
  const third = candidates[2];
  let othersProbability = 0;
  if (third) {
    const thirdShare = outstanding.get(third.name) ?? 0;
    const thirdDifference = thirdShare - leaderShare;
    const thirdMean =
      third.votes - leader.votes + remainingVotes * thirdDifference;
    const thirdSd = Math.sqrt(
      (thirdDifference * sizeSd) ** 2 +
        (remainingVotes * samplingSd) ** 2 +
        (remainingVotes * tau) ** 2
    );
    othersProbability =
      thirdSd > 0 ? clamp01(jstat.normal.cdf(thirdMean / thirdSd, 0, 1)) : 0;
    // Someone outside the top two is the chief threat or no threat; capping at
    // a half keeps that assumption from rescaling the two real contenders into
    // arithmetic nonsense.
    othersProbability = Math.min(0.5, othersProbability);
  }

  return {
    state: 'counting',
    leader,
    runnerUp,
    othersProbability,
    probability: probability * (1 - othersProbability),
    margin,
    remainingVotes: Math.round(remainingVotes),
    remainingLow: Math.max(0, Math.round(remainingVotes - 1.5 * remainingSd)),
    remainingHigh: Math.round(remainingVotes + 1.5 * remainingSd),
    progress,
    enrolment: Math.round(enrolment),
    assumedCycle: cycle.assumed === true,
    insideOutstanding: margin < remainingVotes + 1.5 * remainingSd,
    specialsOutstanding: Math.round(specialsOutstanding),
    // A fifth of the special vote is the differential that has actually
    // decided seats; comparing the margin to the whole special volume would
    // claim almost every close seat could change.
    insideSpecials: margin < specialsOutstanding * 0.2,
    provisionalPrior,
  };
}

/** Convenience wrapper for a dashboard result row. */
export function computeSeatChanceForResult(
  result: ElectorateResults,
  options: {
    prior?: SeatPrior | null;
    nationalSwing?: Record<string, number>;
    tau?: number;
    enrolment?: number;
    electionYear?: number | null;
  }
): SeatChance {
  return computeSeatChance({
    candidates: result.candidateVotes.map((c) => ({
      name: c.candidate,
      party: c.party,
      votes: c.votes,
    })),
    votesCounted: result.votesCounted,
    percentVotesCast: result.percentVotesCast,
    enrolment: options.enrolment,
    electionYear: options.electionYear,
    prior: options.prior,
    nationalSwing: options.nationalSwing,
    tau: options.tau,
  });
}
