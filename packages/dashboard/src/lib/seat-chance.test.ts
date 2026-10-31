import { describe, expect, it } from 'vitest';
import {
  enrolmentForSeat,
  nationalSwingOf,
  priorForSeat,
  seatChanceFor,
  tauFor,
} from '@election-night/core/notional-baseline';
import { CYCLE_CONSTANTS } from '@election-night/core/seat-probability';
import { baselineFor, countProgress, mapFillOpacity } from './seat-chance.js';
import type { ElectorateResult } from '@election-night/core/types';

/** The shipped 2026 baseline, which every lookup below reads through. */
const baseline2026 = baselineFor('2026');

describe('enrolmentForSeat', () => {
  it('reads the enrolled roll recorded beside the prior result', () => {
    // Both figures are the 2023 archive's own `total_votes_cast ÷
    // percent_votes_cast` for the seat — the baseline's only source — and move
    // whenever the baseline is regenerated. A wrong *lookup* would show up here
    // rather than as a seat whose progress never reaches 100%, so the values are
    // pinned against the seat's own record below as well.
    expect(enrolmentForSeat(baseline2026, 'Auckland Central')).toBe(45789);
    expect(enrolmentForSeat(baseline2026, 'Hauraki-Waikato')).toBe(39989);
    for (const name of ['Auckland Central', 'Hauraki-Waikato']) {
      expect(enrolmentForSeat(baseline2026, name)).toBe(
        baseline2026?.seats[name].enrolment
      );
    }
  });

  it('matches regardless of case, macrons and punctuation', () => {
    expect(enrolmentForSeat(baseline2026, 'tamaki makaurau')).toBe(
      enrolmentForSeat(baseline2026, 'Tāmaki Makaurau')
    );
  });

  it('returns nothing for a seat or cycle it has no baseline for', () => {
    expect(enrolmentForSeat(baseline2026, 'Nowhere')).toBeNull();
    expect(
      enrolmentForSeat(baselineFor('2017'), 'Auckland Central')
    ).toBeNull();
    expect(enrolmentForSeat(null, 'Auckland Central')).toBeNull();
  });
});

describe('priors', () => {
  it('gives every seat a prior, including the Māori seats', () => {
    for (const seat of [
      'Auckland Central',
      'Tāmaki Makaurau',
      'Hauraki-Waikato',
      'Ikaroa-Rāwhiti',
    ]) {
      expect(priorForSeat(baseline2026, seat)).not.toBeNull();
    }
  });

  it('carries the party’s prior candidate-vote share, not just the party vote', () => {
    const prior = priorForSeat(baseline2026, 'Banks Peninsula');
    // Keyed by the feed's own party names ("National Party"), which the model
    // canonicalises when it reads them.
    expect(prior?.partyCandidateShare?.['National Party']).toBeCloseTo(
      0.3653,
      3
    );
    expect(prior?.partyCandidateShare?.['Labour Party']).toBeCloseTo(0.3572, 3);
  });

  it('measures tau in share space', () => {
    const tau = tauFor(baseline2026);
    expect(tau).toBeGreaterThan(0.01);
    expect(tau).toBeLessThan(0.2);
  });
});

describe('seatChanceFor', () => {
  const seat = (overrides: Partial<ElectorateResult> = {}) =>
    ({
      electorateName: 'Auckland Central',
      electionYear: 2026,
      votesCounted: 24000,
      percentVotesCast: 0.53,
      candidateVotes: [
        { candidate: 'A, One', party: 'National', votes: 11000 },
        { candidate: 'B, Two', party: 'Labour', votes: 10800 },
        { candidate: 'C, Three', party: 'Green', votes: 2200 },
      ],
      partyVotes: [],
      ...overrides,
    }) as ElectorateResult;

  it('uses the recorded enrolment rather than the reported percentage', () => {
    const chance = seatChanceFor(seat(), baseline2026, {}, '2026');
    if (chance.state !== 'counting') throw new Error('expected counting');
    // The baseline's roll for the seat, not the one tonight's turnout implies.
    expect(chance.enrolment).toBe(45789);
    // 45,789 × 0.795 × 0.78 is tonight's expected total, so a 25,000-vote count
    // leaves about 3,400 to come.
    expect(chance.remainingVotes).toBeLessThan(5000);
  });

  it('reports 100% when the distribution says so, with no cap in the way', () => {
    const chance = seatChanceFor(
      seat({
        candidateVotes: [
          { candidate: 'A, One', party: 'National', votes: 40000 },
          { candidate: 'B, Two', party: 'Labour', votes: 10 },
        ],
      }),
      baseline2026,
      {},
      '2026'
    );
    if (chance.state !== 'counting') throw new Error('expected counting');
    // 40,000 votes against 10 is not a race. It used to be held at 99%; the
    // number now prints what the model thinks, and what keeps an early count
    // humble is the width of its distribution rather than a ceiling.
    expect(chance.probability).toBe(1);
  });

  it('folds candidate votes up to parties for the swing', () => {
    const swing = nationalSwingOf(baseline2026, [seat()]);
    expect(swing).toHaveProperty('National');
    expect(Math.abs(swing.National ?? 0)).toBeLessThan(1);
  });
});

describe('mapFillOpacity', () => {
  const counting = (probability: number) =>
    ({ state: 'counting', probability }) as const;

  it('paints a seat with no votes palest', () => {
    expect(mapFillOpacity(null)).toBeCloseTo(0.15, 3);
    expect(mapFillOpacity({ state: 'waiting' })).toBeCloseTo(0.15, 3);
  });

  it('shades a finished count by its chance, because the specials are still out', () => {
    // A completed count used to be painted solid. The probability now runs to the
    // end of the special vote, so a seat that is finished tonight and 57% to hold
    // must look like a 57% seat — otherwise the map and the panel disagree.
    const complete = (probability: number) =>
      ({
        state: 'complete',
        probability,
        margin: 400,
        leader: { name: 'A', votes: 1 },
        runnerUp: { name: 'B', votes: 2 },
      }) as never;
    expect(mapFillOpacity(complete(0.57))).toBeCloseTo(
      mapFillOpacity(counting(0.57) as never),
      3
    );
    expect(mapFillOpacity(complete(0.5))).toBeCloseTo(0.2, 3);
    expect(mapFillOpacity(complete(0.99))).toBeCloseTo(0.8, 3);
  });

  it('leaves a toss-up pale whoever leads it', () => {
    // 45% and 55% are the same state of knowledge, so they paint the same.
    expect(mapFillOpacity(counting(0.5) as never)).toBeCloseTo(0.2, 3);
    expect(mapFillOpacity(counting(0.55) as never)).toBeCloseTo(
      mapFillOpacity(counting(0.45) as never),
      3
    );
  });

  it('deepens with the chance and never exceeds the finished fill', () => {
    const opacities = [0.5, 0.6, 0.75, 0.9, 0.99].map((p) =>
      mapFillOpacity(counting(p) as never)
    );
    for (let i = 1; i < opacities.length; i++) {
      expect(opacities[i]).toBeGreaterThan(opacities[i - 1]);
    }
    expect(Math.max(...opacities)).toBeLessThanOrEqual(0.8);
  });
});

describe('countProgress', () => {
  it('measures the count against the votes expected tonight, not places reported', () => {
    // Recorded enrolment wins over anything backed out of the live turnout.
    const progress = countProgress(
      [{ electorateName: 'Auckland Central', votesCounted: 12_000 }],
      '2026'
    );
    expect(progress.votesCounted).toBe(12_000);
    // The 2026 cycle's own figures — 79.5% turnout of a 78% night share — not
    // 2023's, which is what this assertion used to borrow while asking for 2026.
    const cycle = CYCLE_CONSTANTS[2026];
    expect(progress.expected).toBeCloseTo(
      enrolmentForSeat(baseline2026, 'Auckland Central')! *
        cycle.turnout *
        cycle.nightShare,
      0
    );
    expect(progress.fraction).toBeCloseTo(0.42, 2);
  });

  it('backs enrolment out of the live turnout when the seat has no record', () => {
    const progress = countProgress(
      [
        {
          electorateName: 'Not On File',
          votesCounted: 900,
          percentVotesCast: 0.2,
        },
      ],
      '2026'
    );
    // 900 votes at 20% turnout implies 4,500 enrolled, and the night's total is
    // that roll at this cycle's turnout and night share.
    const cycle = CYCLE_CONSTANTS[2026];
    expect(progress.expected).toBeCloseTo(
      4_500 * cycle.turnout * cycle.nightShare,
      0
    );
  });

  it('never divides by the share of voting places counted', () => {
    // 90% of places reported with 10% of the votes in: the old arithmetic said
    // 90%, which is how a night looks settled before any advance vote arrives.
    const progress = countProgress(
      [
        {
          electorateName: 'Auckland Central',
          votesCounted: 4_000,
          percentVotesCast: 0.05,
        },
      ],
      '2026'
    );
    expect(progress.fraction).toBeLessThan(0.2);
  });

  it('reports no fraction when neither enrolment nor turnout is known', () => {
    const progress = countProgress(
      [{ electorateName: 'Nowhere', votesCounted: 500 }],
      '2026'
    );
    expect(progress.fraction).toBeNull();
    expect(progress.votesCounted).toBe(0);
  });
});
