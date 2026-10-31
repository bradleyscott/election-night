import jstat from 'jstat';
import type { VotingResults } from './types.js';

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
  // 2026: no published result yet, and this row is an estimate rather than a
  // carry-over. The advance vote is the evidence: 455,522 ballots were banked
  // by the end of the fourth of twelve advance days, 12.0% of the roll against
  // 9.2% at the same point in 2023, and no cycle has run ahead of 2023 without
  // turnout rising (2020: 68% advance, 82.2% turnout). Inheriting 2023's 77.7%
  // would put the night's total *below* the votes the advance count already
  // implies, and an understated total overstates `progress` — the direction
  // that manufactures confidence. The bracket the advance pace supports is
  // 76–82%, so 79.5% is the middle of it.
  //
  // The special share stays at 2023's because the feed cannot say how much of
  // the surge is ordinary advance (counted on the night) and how much is a vote
  // cast at a hub outside the voter's electorate (counted after it). That is the
  // one unknown left, and it is why the night share is not rounded up.
  2026: { year: 2026, turnout: 0.795, nightShare: 0.78, specialShare: 0.21 },
};

/** The newest cycle in the table — the default for one it knows nothing about. */
export const LATEST_CYCLE = 2026;

/**
 * The figures to use for a cycle.
 *
 * An unseen cycle inherits the newest night in the table. That is the
 * conservative direction on purpose: special declarations have risen every
 * cycle, so if this one follows suit the real night total is *smaller* than
 * assumed, the model believes more is outstanding than there is, and it closes
 * seats late rather than early. The spread on the outstanding vote widens to
 * say so.
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
 * The model reports the probability its distribution gives, in full: a seat whose
 * chance rounds to 100% prints 100%. There is deliberately no ceiling short of
 * that — a number held at 99% when the arithmetic says 99.99% is a cap the reader
 * cannot see, and it moves for no reason a reader can observe. The distribution
 * itself is what keeps a live count from claiming certainty: at 20% counted the
 * spread is far too wide to reach 100%, and only a count that is genuinely all but
 * decided gets there.
 *
 * The one exception is `PROVISIONAL_CEILING` below, which caps a seat whose prior
 * is only party-level. That is a statement about the evidence behind the prior,
 * not about rounding.
 */

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

/**
 * How far the special vote's two-candidate split typically strays from the
 * counted vote's, as a standard deviation of vote share.
 *
 * This replaces the old `SPECIALS_DIFFERENTIAL = 0.2`, which was a bound used
 * as a threshold. The question a reader has is not "is the margin under a
 * fifth of the specials" but "how different would the specials have to be, and
 * how likely is that" — and the first half of that is arithmetic, not a
 * constant. So the model computes the swing the specials need to change the
 * seat (see `specialsRequiredSwing` in `computeSeatChance`) and this number
 * turns it into a probability.
 *
 * Where 0.10 comes from, stated as a prior rather than a measurement: in 2023
 * the specials were 21% of the vote and plainly leaned left — enough to move
 * Nelson by 29 votes, Te Atatū by 131 and Tāmaki Makaurau by 4 — which needs a
 * two-candidate differential of roughly 5–15 points between the specials and
 * the ordinary count. A standard deviation of 10 points puts a 95% interval at
 * ±20 points: wide enough to contain a seat where the specials run hard against
 * the leader, tight enough that a 5,000-vote margin in a small seat is not
 * called a coin toss.
 *
 * It is a prior because the differential itself cannot be measured from the
 * archives: the Commission publishes the special vote's volume per electorate
 * but never its party split. Calibrating this against the seats that moved in
 * 2023 is the obvious next step, and it is a single number in one place so the
 * validation harness can do it — the same arrangement `tau` already has.
 */
export const SPECIALS_SWING_SD = 0.1;

/**
 * The special vote is worth a line on the card when the lead has at least a
 * 1-in-20 chance of not surviving it.
 *
 * A threshold, deliberately: the arithmetic can say "possible" for a 4,000-vote
 * margin against a 10,000-vote special vote, and a panel that warns on every
 * arithmetically possible seat warns on nothing. It is the same 95% the
 * provisional-prior ceiling uses for "not a claim", so a seat treated as safe
 * for one reason is not warned about for the other.
 */
const SPECIALS_NOTICE_THRESHOLD = 0.95;

/** Relative uncertainty in the size of the outstanding vote. */
const REMAINING_SIZE_SD = 0.12;

/**
 * Below this the count is treated as the preliminary count, finished: the
 * turnout-scaled estimate says nothing is left. Not exactly 1, because the
 * estimate is not exact and a count that creeps to 0.995 trips far too late.
 *
 * Only used when the seat's place count is unknown. Where it is known, the place
 * count decides instead (see `PLACES_COMPLETE_THRESHOLD`).
 */
const COMPLETE_THRESHOLD = 0.99;

/**
 * Share of a seat's voting places that must have reported before its count is
 * called finished, when the feed tells us.
 *
 * Progress alone cannot carry this. It divides by an estimate of the night's
 * total, so a seat whose roll is understated reaches "99% counted" while a large
 * part of its vote is still out — in 2026's baseline the worst seat's roll was
 * 43% of its real one — and a seat whose turnout runs below the cycle's estimate
 * would never reach the threshold at all, leaving a finished count reporting a
 * probability after midnight. The place count is the Commission's own answer to
 * the same question, so where it exists it wins.
 *
 * All of them, not most of them. This was 0.98 on the argument that the last
 * place or two can be a slow booth and holding a whole seat in `counting` for
 * them helps nobody. A straggler is the better error: the place count is a fact
 * about a closed set, the archives show the bar is attainable — every one of the
 * 72 seat files in both the 2020 and the 2023 archive finishes at exactly
 * `100.0` — and a seat held in `counting` keeps printing how much is still out
 * instead of declaring the count stopped.
 */
const PLACES_COMPLETE_THRESHOLD = 1;

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
  /**
   * Share of this seat's voting places whose results have been received — the
   * feed's `percent_voting_places_counted`, as a fraction.
   *
   * This is the Commission's own statement of how much of the seat has been
   * counted, and it is the one progress signal that cannot be wrong the way the
   * turnout estimate can, because it counts a closed, published set: a place
   * either has a result or it does not. It is **not** read as a share of the
   * vote — a place result is not a vote, and in a general seat most of a seat's
   * place results are advance hubs that all report in one block after 7pm. It is
   * used for the two things it is exact about: a floor under the votes still to
   * come, and the test for whether counting has finished. Absent means no place
   * data, which reproduces turnout-only behaviour.
   */
  placesCounted?: number;
  /** The cycle being counted, so the night's total uses that cycle's figures. */
  electionYear?: number | null;
  /** Overrides the cycle lookup, mostly for tests and the validation harness. */
  cycle?: CycleConstants;
  /** This seat's prior result, rebuilt on the current boundaries. */
  prior?: SeatPrior | null;
  /**
   * This seat's own appetite for special votes, as a multiple of the cycle's
   * national special-vote share — Auckland Central 2023: 34.8% of its votes
   * against a 21.0% national share, so 1.66.
   *
   * Special votes are not spread evenly and the difference is not noise: in
   * 2023 they were 12.7% of Invercargill's vote and 34.8% of Auckland
   * Central's, every Māori seat sat above the national share, and the same
   * seats sit at each end in 2020 and 2023 alike (r = 0.96 between the two
   * cycles). The level moves every cycle, which is why the baseline carries the
   * ratio and the cycle constant carries the level. Absent means no record —
   * the flat national share, which is what every seat used before this existed.
   */
  specialRatio?: number | null;
  /** Party name → national swing in share points, as fractions. */
  nationalSwing?: Record<string, number>;
  tau?: number;
  /**
   * Standard deviation of the special vote's two-candidate swing, as a share of
   * the special vote (see `SPECIALS_SWING_SD`). Overridable so the validation
   * harness can calibrate it without editing the model.
   */
  specialsSwingSd?: number;
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
      /**
       * Chance this candidate wins the seat. The ordinary count is settled, so
       * the only thing still outstanding is the special vote — which means this
       * equals `specialsProbability`. Reported under the same name as the live
       * state's number because it answers the same question.
       */
      probability: number;
      /**
       * How far the special vote's split would have to run against the leader,
       * as a share of the special vote, to take the seat — `margin ÷ specials`.
       * `1` or more means no split of the special vote can do it.
       */
      specialsRequiredSwing: number;
      /** The same number, under the name that says where it comes from. */
      specialsProbability: number;
      /** The lead has a material chance of not surviving the special vote. */
      insideSpecials: boolean;
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
      /**
       * Chance this candidate wins the seat — after the ordinary count *and*
       * the special votes that follow it. The special vote enters as a variance
       * term on the same margin, so the number is the probability the lead
       * survives everything still to be counted.
       */
      probability: number;
      /**
       * The same chance counting tonight's votes only, with the specials left
       * out. Kept because some claims are about the count rather than the seat.
       */
      countProbability: number;
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
      /** `margin ÷ specials`: the swing the special vote needs to take the seat. */
      specialsRequiredSwing: number;
      /** Chance this margin survives the special vote. */
      specialsProbability: number;
      /** The lead has a material chance of not surviving the special vote. */
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

/**
 * What this seat says a candidate's party should start from.
 *
 * Order of preference: the party's share of the candidate vote here (stable
 * across a change of candidate), then the candidate's own result if the party
 * figure is missing, then the party's party-vote share as a last resort. A
 * candidate who did not stand last time is not a reason to lose the prior — in
 * a projection the candidate is an avatar of the party.
 */
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

export type NightRemaining = {
  /** Votes this seat should receive tonight, by the cycle's turnout and night share. */
  expectedNightVotes: number;
  /** Votes still to be counted tonight: the larger of the two signals below. */
  remainingVotes: number;
  /** Share of tonight's votes already counted, 0–1. */
  progress: number;
  /** The seat reported a usable voting-place share. */
  placesKnown: boolean;
};

/**
 * How much of a seat's night is still out, from two independent signals.
 *
 * The turnout estimate says how many votes the night should produce; the place
 * count says how much of the seat has actually been heard from. Neither is
 * right on its own — the turnout estimate turns a seat's roll into votes and
 * inherits every error in the roll, and the place count is a count of places,
 * not votes — but they fail in opposite directions, so the larger of the two is
 * the honest floor: a vote cannot be counted twice, and a place that has not
 * reported still holds votes.
 *
 * Exported because the whole-night strip (`countProgress`) sums the same
 * quantity per seat. Two surfaces cannot quote different progress for one seat,
 * so there is one implementation and both call it.
 */
export function nightRemaining(input: {
  votesCounted: number;
  enrolment: number;
  electionYear?: number | null;
  cycle?: CycleConstants;
  placesCounted?: number;
}): NightRemaining {
  const cycle = input.cycle ?? cycleConstantsFor(input.electionYear);
  const expectedNightVotes = input.enrolment * cycle.turnout * cycle.nightShare;
  const turnoutRemaining = Math.max(0, expectedNightVotes - input.votesCounted);

  const places = clamp01(input.placesCounted ?? 0);
  const placesKnown = places > 0;
  // Votes per place so far, applied to the places that have not reported. A
  // seat is a closed set of places, so this is a count with no denominator to
  // guess — which is exactly what the turnout estimate is short of.
  const placeFloor =
    placesKnown && places < 1
      ? ((1 - places) / places) * input.votesCounted
      : 0;

  const remainingVotes = Math.max(turnoutRemaining, placeFloor);
  const total = input.votesCounted + remainingVotes;
  return {
    expectedNightVotes,
    remainingVotes,
    // Counted over counted-plus-remaining, so the two signals agree: where the
    // place floor binds this is the place percentage, and where the turnout
    // estimate binds it is exactly the old ratio.
    progress: total > 0 ? clamp01(input.votesCounted / total) : 0,
    placesKnown,
  };
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
  // Special votes are not spread evenly: a seat's share of them is stable
  // between cycles while the national level is not, so the baseline carries the
  // ratio and the cycle constant carries the level. Clamped because the
  // product is read as a share of the final vote, and a share above 1 would be
  // a claim about arithmetic rather than about a seat.
  const specialRatio =
    input.specialRatio && input.specialRatio > 0 ? input.specialRatio : 1;
  const specialShare = clamp01(cycle.specialShare * specialRatio);
  const specialsOutstanding = enrolment * cycle.turnout * specialShare;

  // How different would the special vote have to be?
  //
  // The specials replace nothing and cancel nothing: they are votes added to
  // both contenders, so the margin survives unless their *split* differs from
  // the counted vote's. If the leader takes a share `x` of them and the runner-up
  // `y`, the margin becomes `margin + specials × (x − y)`, and the seat changes
  // hands when that goes negative. So the swing the specials must deliver
  // against the leader is exactly `margin ÷ specials`, in share points — a
  // quantity with no free parameters in it at all.
  //
  // That is the number a reader wants: "the specials would have to favour the
  // challenger by 4.4 points more than the count did", not "the margin is under
  // a fifth of the specials".
  const specialsRequiredSwing =
    specialsOutstanding > 0 ? margin / specialsOutstanding : Infinity;
  // The swing is a share that varies from seat to seat and is not measured for
  // any of them, so it is treated as a zero-mean normal with a prior spread.
  // Zero mean is deliberate: the direction of the specials' lean is a
  // cycle-by-cycle political fact this model does not encode, so it says how much
  // a swing of a given size is worth rather than predicting the swing.
  const specialsSwingSd = input.specialsSwingSd ?? SPECIALS_SWING_SD;
  // Positive `swing` means the specials favour the challenger, so the lead holds
  // while the swing stays below what the margin needs. Reported as the
  // distribution gives it: a swing required far beyond the spread reads 100%,
  // and the zero-mean symmetry means a leader is never given worse than even
  // odds — which is the price of not modelling the specials' lean.
  const specialsProbability =
    specialsSwingSd > 0
      ? clamp01(jstat.normal.cdf(specialsRequiredSwing / specialsSwingSd, 0, 1))
      : 1;
  // Worth saying out loud only when the lead is materially exposed.
  const insideSpecials = specialsProbability < SPECIALS_NOTICE_THRESHOLD;

  const { remainingVotes, progress, placesKnown } = nightRemaining({
    votesCounted: input.votesCounted,
    enrolment,
    cycle,
    placesCounted: input.placesCounted,
  });

  // Where the feed tells us how many places have reported, that decides whether
  // the count is finished, because it is a fact rather than an estimate. Where
  // it does not, fall back to the turnout-scaled threshold.
  const countComplete = placesKnown
    ? clamp01(input.placesCounted ?? 0) >= PLACES_COMPLETE_THRESHOLD
    : progress >= COMPLETE_THRESHOLD;
  if (countComplete) {
    return {
      state: 'complete',
      margin,
      leader,
      runnerUp,
      specialsOutstanding,
      probability: specialsProbability,
      specialsRequiredSwing,
      specialsProbability,
      insideSpecials,
    };
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
  // The special vote is one more thing that happens to this margin before the
  // seat is decided, so it enters as one more variance term. Its size is the
  // seat's own measured special volume times the prior spread on the swing, and
  // it applies to every comparison of the same two contenders — which is why it
  // is computed once and added to the night variance rather than modelled
  // separately.
  const specialsVariance = (specialsOutstanding * specialsSwingSd) ** 2;
  const nightVariance =
    (shareDifference * sizeSd) ** 2 +
    (remainingVotes * samplingSd) ** 2 +
    (remainingVotes * tau) ** 2;
  const sd = Math.sqrt(nightVariance + specialsVariance);
  const raw =
    sd > 0 ? clamp01(jstat.normal.cdf(mean / sd, 0, 1)) : mean > 0 ? 1 : 0;
  // The same quantity without the specials: what the number was before the
  // special vote was priced, kept because some claims are about the count.
  const nightSd = Math.sqrt(nightVariance);
  const nightProbability =
    nightSd > 0
      ? clamp01(jstat.normal.cdf(mean / nightSd, 0, 1))
      : mean > 0
        ? 1
        : 0;

  // Nothing is clawed back from what the distribution says, except on a seat
  // whose prior is only party-level: there the prior is an apportionment rather
  // than this seat's own history, and the model will not call a seat on the
  // strength of it. The floor mirrors whichever ceiling applies, so the stated
  // remainder is the same on both sides.
  const ceiling = provisionalPrior ? PROVISIONAL_CEILING : 1;
  const floor = 1 - ceiling;
  const probability = Math.min(ceiling, Math.max(floor, raw));
  const countProbability = Math.min(ceiling, Math.max(floor, nightProbability));

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
        (remainingVotes * tau) ** 2 +
        specialsVariance
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
    countProbability: countProbability * (1 - othersProbability),
    margin,
    remainingVotes: Math.round(remainingVotes),
    remainingLow: Math.max(0, Math.round(remainingVotes - 1.5 * remainingSd)),
    remainingHigh: Math.round(remainingVotes + 1.5 * remainingSd),
    progress,
    enrolment: Math.round(enrolment),
    assumedCycle: cycle.assumed === true,
    insideOutstanding: margin < remainingVotes + 1.5 * remainingSd,
    specialsOutstanding: Math.round(specialsOutstanding),
    specialsRequiredSwing,
    specialsProbability,
    insideSpecials,
    provisionalPrior,
  };
}
