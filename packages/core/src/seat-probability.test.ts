import { describe, expect, it } from 'vitest';
import {
  computeObservedSwing,
  computeSeatChance,
  canonicalParty,
  cycleConstantsFor,
  CYCLE_CONSTANTS,
  DEFAULT_TAU,
  LATEST_CYCLE,
  type SeatChanceInput,
  type SeatPrior,
} from './seat-probability.js';

const prior: SeatPrior = {
  partyShare: { National: 0.4, Labour: 0.35, Green: 0.15, Other: 0.1 },
  candidateShare: {
    'LEADER, One': 0.4,
    'RUNNER, Two': 0.35,
    'THIRD, Three': 0.25,
  },
};

function input(overrides: Partial<SeatChanceInput> = {}): SeatChanceInput {
  return {
    candidates: [
      { name: 'LEADER, One', party: 'National', votes: 1600 },
      { name: 'RUNNER, Two', party: 'Labour', votes: 1400 },
      { name: 'THIRD, Three', party: 'Green', votes: 0 },
    ],
    votesCounted: 3000,
    // 3000 votes at 30% turnout means 10,000 enrolled, so tonight's total is
    // 10,000 × 0.777 × 0.783 ≈ 6,084 and about 3,084 votes are still out.
    percentVotesCast: 0.3,
    prior,
    nationalSwing: {},
    tau: DEFAULT_TAU,
    ...overrides,
  };
}

describe('computeSeatChance', () => {
  it('reports nothing before a vote is counted', () => {
    expect(computeSeatChance(input({ votesCounted: 0 })).state).toBe('waiting');
  });

  it('reports nothing without turnout', () => {
    expect(computeSeatChance(input({ percentVotesCast: 0 })).state).toBe(
      'waiting'
    );
  });

  it('reports a margin, not a probability, once the count is finished', () => {
    // 0.62 turnout means 4,840 enrolled and a night total near 2,945, which the
    // 3,000 counted votes already exceed.
    const chance = computeSeatChance(
      input({ votesCounted: 3000, percentVotesCast: 0.62 })
    );
    expect(chance.state).toBe('complete');
    if (chance.state !== 'complete') return;
    expect(chance.margin).toBe(200);
    expect(chance.leader.name).toBe('LEADER, One');
    expect(chance.runnerUp.name).toBe('RUNNER, Two');
  });

  it('recovers the outstanding vote from turnout and the prior night share', () => {
    const chance = computeSeatChance(input());
    expect(chance.state).toBe('counting');
    if (chance.state !== 'counting') return;
    const enrolment = 3000 / 0.3;
    const cycle = CYCLE_CONSTANTS[LATEST_CYCLE];
    const expected = enrolment * cycle.turnout * cycle.nightShare;
    expect(chance.remainingVotes).toBe(Math.round(expected - 3000));
    expect(chance.progress).toBeCloseTo(3000 / expected, 3);
  });

  it('gives a comfortable leader a high chance and an unproven one a middling chance', () => {
    const comfortable = computeSeatChance(input());
    const tossUp = computeSeatChance(
      input({
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 1505 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 1495 },
          { name: 'THIRD, Three', party: 'Green', votes: 0 },
        ],
      })
    );
    expect(comfortable.state).toBe('counting');
    expect(tossUp.state).toBe('counting');
    if (comfortable.state !== 'counting' || tossUp.state !== 'counting') return;
    expect(comfortable.probability).toBeGreaterThan(0.9);
    expect(tossUp.probability).toBeGreaterThan(0.2);
    expect(tossUp.probability).toBeLessThan(0.8);
  });

  it('says a seat can still change when the margin is inside the votes out', () => {
    const chance = computeSeatChance(
      input({
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 1520 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 1480 },
          { name: 'THIRD, Three', party: 'Green', votes: 0 },
        ],
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.margin).toBe(40);
    expect(chance.insideOutstanding).toBe(true);
  });

  it('says a seat cannot change when the margin exceeds the votes out', () => {
    const chance = computeSeatChance(
      input({
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 2400 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 600 },
          { name: 'THIRD, Three', party: 'Green', votes: 0 },
        ],
        // A busier roll leaves less outstanding: about 1,560 votes still out.
        percentVotesCast: 0.42,
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.margin).toBe(1800);
    expect(chance.margin).toBeGreaterThan(chance.remainingHigh);
    expect(chance.insideOutstanding).toBe(false);
  });

  it('marks a seat with no prior as leaning on its own count', () => {
    const chance = computeSeatChance(input({ prior: null }));
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.provisionalPrior).toBe(true);
  });

  it("projects a new candidate from the party's prior candidate vote", () => {
    // The person changed; the party did not. A projection keeps the seat's
    // prior because the candidate stands for the party.
    const withPartyPrior: SeatPrior = {
      ...prior,
      partyCandidateShare: { National: 0.44, Labour: 0.38, Green: 0.12 },
    };
    const old = computeSeatChance(input({ prior: withPartyPrior }));
    const fresh = computeSeatChance(
      input({
        prior: withPartyPrior,
        candidates: [
          { name: 'SMITH, Logan', party: 'National', votes: 1600 },
          { name: 'JOHNSON, Logan', party: 'Labour', votes: 1400 },
          { name: 'WILLIAMS, Logan', party: 'Green', votes: 0 },
        ],
      })
    );
    if (old.state !== 'counting' || fresh.state !== 'counting') {
      throw new Error('expected live counts');
    }
    expect(fresh.provisionalPrior).toBe(false);
    expect(fresh.probability).toBeCloseTo(old.probability, 6);
  });

  it('falls back to the party prior when no candidate stood last time', () => {
    // Every candidate is new, so only the party-level prior survives — and a
    // swing is a movement, not a share. Read as a share it would hand the
    // leader every remaining vote and report a certainty.
    const chance = computeSeatChance(
      input({
        candidates: [
          { name: 'SMITH, Logan', party: 'National', votes: 1600 },
          { name: 'JOHNSON, Logan', party: 'Labour', votes: 1400 },
          { name: 'WILLIAMS, Logan', party: 'Green', votes: 0 },
        ],
        nationalSwing: { National: 0.01, Labour: -0.02 },
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.provisionalPrior).toBe(true);
    // A party-level prior is not this seat's own history, so the ceiling is
    // lower than the 99% a name-matched seat can reach.
    expect(chance.probability).toBeLessThanOrEqual(0.95);
    expect(chance.probability).toBeGreaterThan(0.5);
  });

  it('never claims certainty on a count that is not finished', () => {
    const chance = computeSeatChance(
      input({
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 2900 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 100 },
          { name: 'THIRD, Three', party: 'Green', votes: 0 },
        ],
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.probability).toBeLessThanOrEqual(0.99);
    expect(chance.probability).toBeGreaterThan(0.9);
  });

  it('puts the leader and runner-up chances on a two-way simplex', () => {
    const chance = computeSeatChance(input());
    if (chance.state !== 'counting') throw new Error('expected a live count');
    const runnerUp = 1 - chance.probability;
    expect(chance.probability + runnerUp).toBeCloseTo(1, 10);
    expect(chance.probability).toBeGreaterThanOrEqual(0);
    expect(chance.probability).toBeLessThanOrEqual(1);
  });
});

describe('computeObservedSwing', () => {
  it('averages each party movement weighted by the votes counted', () => {
    const swing = computeObservedSwing([
      {
        prior: {
          partyShare: { National: 0.4, Labour: 0.35 },
          candidateShare: {},
        },
        parties: [
          { candidate: 'National', votes: 450 },
          { candidate: 'Labour', votes: 550 },
        ],
        votesCounted: 1000,
      },
      {
        prior: {
          partyShare: { National: 0.4, Labour: 0.35 },
          candidateShare: {},
        },
        parties: [
          { candidate: 'National', votes: 700 },
          { candidate: 'Labour', votes: 300 },
        ],
        votesCounted: 1000,
      },
    ]);
    // National: (+0.05 × 1000 + +0.30 × 1000) / 2000
    expect(swing.National).toBeCloseTo(0.175, 6);
    // Labour: (+0.20 × 1000 + −0.05 × 1000) / 2000. The deltas do not sum to
    // zero here because the fixture's prior lists only two parties.
    expect(swing.Labour).toBeCloseTo(0.075, 6);
  });

  it('ignores seats with no prior or no count', () => {
    const swing = computeObservedSwing([
      {
        prior: null,
        parties: [{ candidate: 'National', votes: 900 }],
        votesCounted: 1000,
      },
      {
        prior: { partyShare: { National: 0.5 }, candidateShare: {} },
        parties: [],
        votesCounted: 0,
      },
    ]);
    expect(swing).toEqual({});
  });
});

describe('composition term', () => {
  // A seat whose first 2,000 counted votes put National ahead even though the
  // prior had Labour comfortably in front — the shape of an advance-heavy
  // early count, which is where the sampling-only weight misleads most.
  const early = input({
    candidates: [
      { name: 'LEADER, One', party: 'National', votes: 1020 },
      { name: 'RUNNER, Two', party: 'Labour', votes: 980 },
      { name: 'THIRD, Three', party: 'Green', votes: 0 },
    ],
    votesCounted: 2000,
    percentVotesCast: 0.3,
    prior: {
      partyShare: { National: 0.3, Labour: 0.45, Green: 0.25 },
      candidateShare: { 'LEADER, One': 0.3, 'RUNNER, Two': 0.45 },
    },
  });

  it('stops a thin early count from overruling the prior', () => {
    const samplingOnly = computeSeatChance({ ...early, composition: 0 });
    const composed = computeSeatChance({ ...early, composition: 1 });
    expect(samplingOnly.state).toBe('counting');
    expect(composed.state).toBe('counting');
    if (samplingOnly.state !== 'counting' || composed.state !== 'counting')
      return;

    // Sampling variance alone gives 2,000 votes 97% of the weight, so the count
    // overrules a prior that disagrees with it. Adding the composition gap holds
    // the estimate back toward the prior and produces the less certain number.
    expect(samplingOnly.probability).toBeGreaterThan(composed.probability);
    expect(samplingOnly.probability - composed.probability).toBeGreaterThan(
      0.1
    );
  });

  it('barely moves the number once the count is nearly complete', () => {
    const nearlyDone = { ...early, percentVotesCast: 0.566 };
    const samplingOnly = computeSeatChance({ ...nearlyDone, composition: 0 });
    const composed = computeSeatChance({ ...nearlyDone, composition: 1 });
    if (samplingOnly.state !== 'counting' || composed.state !== 'counting')
      return;
    expect(
      Math.abs(samplingOnly.probability - composed.probability)
    ).toBeLessThan(0.01);
  });
});

describe('cycle constants', () => {
  it('uses the cycle’s own turnout and night share', () => {
    expect(CYCLE_CONSTANTS[2017].nightShare).toBeCloseTo(0.838, 3);
    expect(CYCLE_CONSTANTS[2020].nightShare).toBeCloseTo(0.821, 3);
    expect(CYCLE_CONSTANTS[2023].nightShare).toBeCloseTo(0.783, 3);
    expect(cycleConstantsFor(2020).turnout).toBeCloseTo(0.819, 3);
    expect(cycleConstantsFor(2020).assumed).toBeUndefined();
  });

  it('carries the newest cycle forward for an election it has no figures for', () => {
    const assumed = cycleConstantsFor(2026);
    expect(assumed.assumed).toBe(true);
    expect(assumed.year).toBe(2026);
    expect(assumed.nightShare).toBe(CYCLE_CONSTANTS[LATEST_CYCLE].nightShare);
    expect(cycleConstantsFor(null).assumed).toBe(true);
  });

  it('closes late rather than early when the cycle is assumed', () => {
    const known = computeSeatChance({
      ...input(),
      electionYear: 2023,
      cycle: CYCLE_CONSTANTS[2023],
    });
    const assumed = computeSeatChance({
      ...input(),
      electionYear: 2026,
      cycle: cycleConstantsFor(2026),
    });
    if (known.state !== 'counting' || assumed.state !== 'counting') {
      throw new Error('expected counting states');
    }
    // The same count, read against a cycle with no published figures, can never
    // look more decided than it does against the cycle whose figures we know.
    expect(assumed.probability).toBeLessThanOrEqual(known.probability + 1e-9);
    expect(assumed.assumedCycle).toBe(true);
    expect(known.assumedCycle).toBe(false);
  });
});

describe('canonicalParty', () => {
  it('treats the feed’s names and common short names as one party', () => {
    expect(canonicalParty('National Party')).toBe(canonicalParty('National'));
    expect(canonicalParty('Labour Party')).toBe(canonicalParty('Labour'));
    expect(canonicalParty('ACT New Zealand')).toBe(canonicalParty('ACT'));
    expect(canonicalParty('New Zealand First Party')).toBe(
      canonicalParty('NZF')
    );
    expect(canonicalParty('Māori Party')).toBe(canonicalParty('Te Pāti Māori'));
    expect(canonicalParty('Green Party')).toBe(canonicalParty('Green'));
  });

  it('reads a prior keyed by the feed’s name when the result says the short one', () => {
    const chance = computeSeatChance(
      input({
        prior: {
          partyShare: { 'National Party': 0.4, 'Labour Party': 0.35 },
          candidateShare: {},
          partyCandidateShare: { 'National Party': 0.42, 'Labour Party': 0.34 },
        },
        candidates: [
          { name: 'NEW PERSON', party: 'National', votes: 600 },
          { name: 'OTHER PERSON', party: 'Labour', votes: 400 },
        ],
      })
    );
    if (chance.state !== 'counting') throw new Error('expected counting');
    // A party's candidate-vote share transfers to its new candidate.
    expect(chance.provisionalPrior).toBe(false);
  });
});

describe('enrolment', () => {
  const thinSeat: Partial<SeatChanceInput> = {
    votesCounted: 200,
    candidates: [
      { name: 'LEADER, One', party: 'National', votes: 120 },
      { name: 'RUNNER, Two', party: 'Labour', votes: 80 },
    ],
  };

  it('prefers a known roll over back-solving from a rounded percentage', () => {
    // 200 votes at "0.4%" implies 50,000 enrolled; the seat's real roll is
    // 45,407. The recorded figure is the one to use.
    const fromRecord = computeSeatChance(
      input({ ...thinSeat, enrolment: 45407, percentVotesCast: 0.004 })
    );
    const fromPercent = computeSeatChance(
      input({ ...thinSeat, percentVotesCast: 0.004 })
    );
    if (fromRecord.state !== 'counting' || fromPercent.state !== 'counting') {
      throw new Error('expected counting states');
    }
    expect(fromRecord.enrolment).toBe(45407);
    expect(fromPercent.enrolment).toBe(50000);
    expect(fromRecord.remainingVotes).toBeLessThan(fromPercent.remainingVotes);
  });

  it('refuses to guess when it has neither figure', () => {
    expect(computeSeatChance({ candidates: [], votesCounted: 0 }).state).toBe(
      'waiting'
    );
    expect(
      computeSeatChance(input({ enrolment: 0, percentVotesCast: 0 })).state
    ).toBe('waiting');
  });
});
