import { describe, expect, it } from 'vitest';
import type { ElectorateResult } from './seat-chance.js';
import {
  enrolmentForSeat,
  nationalSwingOf,
  priorForSeat,
  seatChanceFor,
  tauFor,
} from './seat-chance.js';

describe('enrolmentForSeat', () => {
  it('reads the enrolled roll recorded beside the prior result', () => {
    // Both figures come from the shipped baseline, so a wrong lookup shows up
    // here rather than as a seat whose progress never reaches 100%.
    expect(enrolmentForSeat('Auckland Central', '2026')).toBe(45407);
    expect(enrolmentForSeat('Hauraki-Waikato', '2026')).toBe(39656);
  });

  it('matches regardless of case, macrons and punctuation', () => {
    expect(enrolmentForSeat('tamaki makaurau', '2026')).toBe(
      enrolmentForSeat('Tāmaki Makaurau', '2026')
    );
  });

  it('returns nothing for a seat or cycle it has no baseline for', () => {
    expect(enrolmentForSeat('Nowhere', '2026')).toBeNull();
    expect(enrolmentForSeat('Auckland Central', '2017')).toBeNull();
    expect(enrolmentForSeat(null, '2026')).toBeNull();
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
      expect(priorForSeat(seat, '2026')).not.toBeNull();
    }
  });

  it('carries the party’s prior candidate-vote share, not just the party vote', () => {
    const prior = priorForSeat('Banks Peninsula', '2026');
    // Keyed by the feed's own party names ("National Party"), which the model
    // canonicalises when it reads them.
    expect(prior?.partyCandidateShare?.['National Party']).toBeCloseTo(
      0.3653,
      3
    );
    expect(prior?.partyCandidateShare?.['Labour Party']).toBeCloseTo(0.3572, 3);
  });

  it('measures tau in share space', () => {
    const tau = tauFor('2026');
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
    const chance = seatChanceFor(seat(), '2026', {});
    if (chance.state !== 'counting') throw new Error('expected counting');
    expect(chance.enrolment).toBe(45407);
    // 45,407 × 0.777 × 0.783 is tonight's expected total.
    expect(chance.remainingVotes).toBeLessThan(5000);
  });

  it('never reports more than 99% while the count is unfinished', () => {
    const chance = seatChanceFor(
      seat({
        candidateVotes: [
          { candidate: 'A, One', party: 'National', votes: 40000 },
          { candidate: 'B, Two', party: 'Labour', votes: 10 },
        ],
      }),
      '2026',
      {}
    );
    if (chance.state !== 'counting') throw new Error('expected counting');
    expect(chance.probability).toBeLessThanOrEqual(0.99);
  });

  it('folds candidate votes up to parties for the swing', () => {
    const swing = nationalSwingOf([seat()], '2026');
    expect(swing).toHaveProperty('National');
    expect(Math.abs(swing.National ?? 0)).toBeLessThan(1);
  });
});
