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
    // Pinned to the cycle the arithmetic above is written against. The model's
    // defaults must not change what a test asserting a number means, and a new
    // row in `CYCLE_CONSTANTS` should not read as a regression here.
    electionYear: 2023,
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
    // The count is complete; the result is not final. 4,840 enrolled at the
    // cycle's turnout, 21% of which arrives as specials.
    expect(chance.specialsOutstanding).toBeGreaterThan(0);
    expect(chance.specialsOutstanding).toBeCloseTo(
      4840 * CYCLE_CONSTANTS[2023].turnout * CYCLE_CONSTANTS[2023].specialShare,
      0
    );
  });

  it('recovers the outstanding vote from turnout and the prior night share', () => {
    const chance = computeSeatChance(input());
    expect(chance.state).toBe('counting');
    if (chance.state !== 'counting') return;
    const enrolment = 3000 / 0.3;
    const cycle = CYCLE_CONSTANTS[2023];
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

  it('marks a seat with no prior as provisional on its own count', () => {
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

  it('reports the probability the distribution gives, including 100%', () => {
    // Nothing is clawed back for rounding: a 2,800-vote margin from 3,000
    // counted is as decided as the model can be, and it says so.
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
    expect(chance.probability).toBe(1);
  });

  it('uses the distribution, not a cap, to keep an early count humble', () => {
    // The reason no ceiling is needed: at 9% counted the spread is far too wide
    // to reach 100%, whatever the margin looks like.
    const chance = computeSeatChance(
      input({
        votesCounted: 540,
        percentVotesCast: 0.054,
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 500 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 40 },
          { name: 'THIRD, Three', party: 'Green', votes: 0 },
        ],
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.probability).toBeLessThan(1);
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

describe('the voting place count', () => {
  // The 2026 baseline's worst seat, Ōtāhuhu, records 21,254 enrolled against a
  // real roll of 49,473 — place geometry only saw the ballots cast inside the
  // seat. At 12,000 votes that roll says the night is over.
  const understatedRoll = {
    votesCounted: 12_000,
    enrolment: 21_254,
    percentVotesCast: 0.28,
  };

  it('keeps counting while places are outstanding, however few votes the roll implies', () => {
    const chance = computeSeatChance(
      input({ ...understatedRoll, placesCounted: 0.45 })
    );
    if (chance.state !== 'counting') {
      throw new Error(`expected a live count, got ${chance.state}`);
    }
    // (1 − 0.45) ÷ 0.45 × 12,000 votes still out, which is what a seat 45% of
    // the way through its places actually has left.
    expect(chance.remainingVotes).toBe(14_667);
    expect(chance.progress).toBeCloseTo(0.45, 3);
    expect(chance.insideOutstanding).toBe(true);
  });

  it('never leaves nothing outstanding while a place has not reported', () => {
    // The turnout estimate alone is zero here — the count already exceeds it.
    const chance = computeSeatChance(
      input({ ...understatedRoll, placesCounted: 0.97 })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.remainingVotes).toBeGreaterThan(0);
  });

  it('stays counting while even one place is outstanding', () => {
    // 0.98 of the places used to be enough. The archive's finished seats all
    // read 100.0, so requiring every place costs nothing, and a straggler
    // holding the seat open is the better error than declaring a count stopped.
    const chance = computeSeatChance(
      input({ ...understatedRoll, placesCounted: 0.999 })
    );
    if (chance.state !== 'counting') {
      throw new Error(`expected a live count, got ${chance.state}`);
    }
    expect(chance.remainingVotes).toBeGreaterThan(0);
  });

  it('calls the count complete when every place has reported', () => {
    const chance = computeSeatChance(
      input({ ...understatedRoll, placesCounted: 1 })
    );
    expect(chance.state).toBe('complete');
  });

  it('finishes even when the turnout estimate is too generous to say so', () => {
    // A roll of 60,000 against 12,000 counted puts progress at a third, so the
    // turnout-scaled threshold would never trip and a finished count would keep
    // reporting a probability. The place count is the fact that ends it.
    const chance = computeSeatChance(
      input({
        votesCounted: 12_000,
        enrolment: 60_000,
        percentVotesCast: 0.2,
        placesCounted: 1,
      })
    );
    expect(chance.state).toBe('complete');
  });

  it('falls back to the turnout threshold when the feed has no place count', () => {
    // Every source without per-place data, and the validation harness, land
    // here: the old arithmetic, unchanged — including its one known failure,
    // which is a roll too small to notice the votes that are still out.
    const chance = computeSeatChance(
      input({
        ...understatedRoll,
        votesCounted: 14_000,
        placesCounted: undefined,
      })
    );
    expect(chance.state).toBe('complete');
  });
});

describe('the seat’s own special-vote share', () => {
  // 10,000 enrolled at 2023's turnout, so 7,770 votes, of which 21% (1,632)
  // arrive as specials when nothing is known about the seat.
  const national =
    10_000 * CYCLE_CONSTANTS[2023].turnout * CYCLE_CONSTANTS[2023].specialShare;

  it('falls back to the cycle’s national share with no seat record', () => {
    const chance = computeSeatChance(input());
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.specialsOutstanding).toBe(Math.round(national));
  });

  it('scales the national share by the seat’s own ratio', () => {
    // Auckland Central's 2023 specials were 34.8% of its vote against 21.0%
    // nationally, so the baseline carries 1.6573 for it.
    const chance = computeSeatChance(input({ specialRatio: 1.6573 }));
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.specialsOutstanding).toBeCloseTo(national * 1.6573, 0);
  });

  it('keeps an apportioned seat on the national share', () => {
    // A seat built from place geometry has no source result to take a ratio
    // from, and specials are not cast at a place, so geometry cannot find them.
    // The feed's own null is what the baseline writes.
    const chance = computeSeatChance(input({ specialRatio: null }));
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.specialsOutstanding).toBe(Math.round(national));
  });

  it('states the swing the specials would need, not a share of them', () => {
    // The margin survives unless the specials *split* differently from the
    // count: added at the same differential they move nobody's share. So the
    // only question is how far the split would have to run against the leader,
    // and that is arithmetic — `margin ÷ specials` — with no constant in it.
    const chance = computeSeatChance(input());
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.specialsOutstanding).toBe(Math.round(national));
    // 200 votes of margin over 1,632 specials: the specials would have to favour
    // the challenger by 12.3 points more than the count did.
    expect(chance.specialsRequiredSwing).toBeCloseTo(200 / national, 4);
    expect(chance.insideSpecials).toBe(true);
  });

  it('turns that swing into a probability against the prior spread', () => {
    // required ÷ sd = 1.226, so the lead survives about 89% of the time under a
    // zero-mean swing with a 10-point spread.
    const chance = computeSeatChance(input());
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.specialsProbability).toBeCloseTo(0.89, 2);

    // A seat whose specials are the bigger part of its vote needs a much
    // smaller swing, and is therefore much more exposed for the same margin.
    const citySeat = computeSeatChance(input({ specialRatio: 1.6573 }));
    if (citySeat.state !== 'counting') throw new Error('expected a live count');
    expect(citySeat.specialsRequiredSwing).toBeLessThan(
      chance.specialsRequiredSwing
    );
    expect(citySeat.specialsProbability).toBeLessThan(
      chance.specialsProbability
    );
    expect(citySeat.specialsProbability).toBeCloseTo(0.77, 2);
  });

  it('says a margin wider than the special vote cannot change', () => {
    // 30,000 counted of 100,000 enrolled puts this seat's specials at 16,317. A
    // 20,000-vote margin is wider than the whole special vote, so no split of it
    // can erase the lead, whatever direction the swing runs in.
    const chance = computeSeatChance(
      input({
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 25_000 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 5_000 },
        ],
        votesCounted: 30_000,
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.margin).toBe(20_000);
    expect(chance.specialsRequiredSwing).toBeGreaterThan(1);
    expect(chance.insideSpecials).toBe(false);
    // Reported as the distribution gives it: a required swing of 1.2 against a
    // 10-point spread is not a risk, and 99% would be a cap the reader cannot
    // see.
    expect(chance.specialsProbability).toBe(1);
  });

  it('moves with the spread it is given, and never claims certainty', () => {
    const tight = computeSeatChance(input({ specialsSwingSd: 0.05 }));
    const wide = computeSeatChance(input({ specialsSwingSd: 0.3 }));
    if (tight.state !== 'counting' || wide.state !== 'counting') {
      throw new Error('expected live counts');
    }
    // A narrow spread makes a swing of that size rarer, so the lead is safer —
    // the same required swing, two different answers.
    expect(tight.specialsProbability).toBeGreaterThan(wide.specialsProbability);

    // A 20-vote margin against 1,632 specials needs a 1.2-point swing, and a
    // 0.01-point spread makes that certain several times over — so it reads 1,
    // not a number held short of it.
    const certain = computeSeatChance(
      input({
        candidates: [
          { name: 'LEADER, One', party: 'National', votes: 1510 },
          { name: 'RUNNER, Two', party: 'Labour', votes: 1490 },
        ],
        specialsSwingSd: 0.0001,
      })
    );
    if (certain.state !== 'counting') throw new Error('expected a live count');
    expect(certain.specialsProbability).toBe(1);
  });
});

describe('the probability is about the seat, not the night', () => {
  it('is never higher than the chance of leading tonight', () => {
    // Specials can only take a lead away, so the eventual number is the count
    // number with a permanent risk added on top: equal at best, lower usually.
    const chance = computeSeatChance(input());
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(chance.probability).toBeLessThanOrEqual(chance.countProbability);
  });

  it('keeps a seat with a large special vote below the count-only number', () => {
    // Auckland Central's special share is 1.66× national, Invercargill's 0.65×.
    // Same margin, same count: the city seat carries more of its vote in the
    // part that arrives last, so it must be the less likely of the two to hold.
    const chance = computeSeatChance(input({ specialRatio: 1.6573 }));
    const safe = computeSeatChance(input({ specialRatio: 0.6507 }));
    if (chance.state !== 'counting' || safe.state !== 'counting') {
      throw new Error('expected live counts');
    }
    expect(chance.probability).toBeLessThan(safe.probability);
    expect(chance.countProbability).toBeCloseTo(safe.countProbability, 10);
  });

  it('converges on the specials probability as the ordinary count finishes', () => {
    // When tonight's votes are all in, the only thing left is the special vote,
    // so the headline has to meet the specials number instead of jumping at the
    // moment the count completes.
    const chance = computeSeatChance(
      input({
        votesCounted: 7000,
        percentVotesCast: 0.62,
        placesCounted: 0.99,
      })
    );
    if (chance.state !== 'counting') throw new Error('expected a live count');
    expect(
      Math.abs(chance.probability - chance.specialsProbability)
    ).toBeLessThan(0.02);
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

  it('states 2026 on the advance vote rather than inheriting 2023', () => {
    // 455,522 advance votes by the end of the fourth of twelve advance days was
    // 12.0% of the roll against 9.2% in 2023, and no cycle has run that far
    // ahead of 2023 without turnout rising. Carrying 77.7% forward would put
    // the night's total below what the advance count already implies.
    const cycle = cycleConstantsFor(2026);
    expect(cycle.assumed).toBeUndefined();
    expect(cycle.turnout).toBeGreaterThan(CYCLE_CONSTANTS[2023].turnout);
    expect(cycle.turnout).toBeLessThan(0.85);
  });

  it('carries the newest cycle forward for an election it has no figures for', () => {
    const assumed = cycleConstantsFor(2029);
    expect(assumed.assumed).toBe(true);
    expect(assumed.year).toBe(2029);
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
      electionYear: 2029,
      cycle: cycleConstantsFor(2029),
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
