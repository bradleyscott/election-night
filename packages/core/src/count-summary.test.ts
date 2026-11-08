import { describe, expect, it } from 'vitest';
import {
  COUNT_SUMMARY_VERSION,
  summarizeCount,
  summarizeNationalCount,
  type CountSummaryInput,
} from './count-summary.js';
import type { SeatChance } from './seat-probability.js';

function seat(
  overrides: Partial<CountSummaryInput['result']> = {}
): CountSummaryInput {
  return {
    result: {
      votesCounted: 10_000,
      candidateVotes: [{ votes: 4_000 }, { votes: 3_500 }, { votes: 2_500 }],
      partyVotes: [{ votes: 4_100 }, { votes: 3_400 }, { votes: 2_500 }],
      votePercentageCounted: 0.5,
      percentVotesCast: 0.3,
      ...overrides,
    },
    electionYear: 2023,
  };
}

const countingChance: SeatChance = {
  state: 'counting',
  leader: { name: 'A', votes: 4_000 },
  runnerUp: { name: 'B', votes: 3_500 },
  othersProbability: 0.02,
  probability: 0.6,
  countProbability: 0.6,
  margin: 500,
  remainingVotes: 15_300,
  remainingLow: 12_000,
  remainingHigh: 18_000,
  progress: 0.68,
  enrolment: 45_407,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 5_000,
  specialsRequiredSwing: 0.1,
  specialsProbability: 0.75,
  insideSpecials: true,
  provisionalPrior: false,
};

describe('summarizeCount', () => {
  it('keeps contributing places and in-seat booths as separate sets', () => {
    // Mt Albert: 24 of 24 booths inside the electorate, but 90 of 102
    // contributing places (advance hubs elsewhere count here too).
    const summary = summarizeCount({
      ...seat(),
      contributingPlaces: { counted: 90, total: 102 },
      inSeatBooths: { counted: 24, total: 24 },
    });

    expect(summary.places.contributingReported).toBe(90);
    expect(summary.places.contributingTotal).toBe(102);
    expect(summary.places.contributingFraction).toBeCloseTo(90 / 102);
    expect(summary.places.inSeatBoothsReported).toBe(24);
    expect(summary.places.inSeatBoothsTotal).toBe(24);
    expect(summary.places.inSeatBoothsFraction).toBe(1);
  });

  it('uses the place floor for Nelson and does not double-count turnout', () => {
    // 28,816 counted, 44.7% of contributing places. The place floor is
    // ((1 - 0.447) / 0.447) × 28,816 ≈ 35,649. Turnout at 45,000 enrolled for
    // 2023 expects ~27,371, below the count, so the floor wins.
    const summary = summarizeCount({
      result: {
        votesCounted: 28_816,
        votePercentageCounted: 0.447,
        candidateVotes: [{ votes: 28_816 }],
        partyVotes: [{ votes: 28_816 }],
      },
      enrolment: 45_000,
      electionYear: 2023,
    });

    expect(summary.ordinary.state).toBe('counting');
    expect(summary.ordinary.remaining?.value).toBeCloseTo(35_649, -1);
    expect(summary.ordinary.progress).toBeCloseTo(28_816 / 64_465, 2);
  });

  it('treats a missing enrolment as unknown, not zero or complete', () => {
    const summary = summarizeCount(seat());
    expect(summary.ordinary.state).toBe('unknown');
    expect(summary.ordinary.remaining).toBeNull();
    expect(summary.ordinary.progress).toBeNull();
    // The counted facts are still present.
    expect(summary.facts.votesCounted).toBe(10_000);
    expect(summary.phase).toBe('counting');
  });

  it('does not call a zero result complete', () => {
    const summary = summarizeCount(
      seat({
        votesCounted: 0,
        candidateVotes: [],
        partyVotes: [],
        votePercentageCounted: 0,
      })
    );
    expect(summary.ordinary.state).toBe('unknown');
    expect(summary.phase).toBe('unknown');
    expect(summary.facts.votesCounted).toBe(0);
  });

  it('completes the ordinary count when every place reports, even below forecast', () => {
    // 20,000 votes where the turnout estimate expects 18,245: the forecast has
    // run low, but every place has reported, so the count is complete.
    const summary = summarizeCount({
      result: {
        votesCounted: 20_000,
        votePercentageCounted: 1,
        candidateVotes: [{ votes: 20_000 }],
        partyVotes: [{ votes: 20_000 }],
      },
      enrolment: 30_000,
      electionYear: 2023,
    });

    expect(summary.ordinary.state).toBe('complete');
    expect(summary.ordinary.remaining?.value).toBe(0);
    expect(summary.ordinary.progress).toBe(1);
    expect(summary.phase).toBe('preliminary-complete');
  });

  it('records a candidate/party difference without forcing equality', () => {
    const summary = summarizeCount(
      seat({
        candidateVotes: [{ votes: 1_000 }, { votes: 900 }],
        partyVotes: [{ votes: 1_898 }],
      })
    );
    expect(summary.facts.candidateVotes).toBe(1_900);
    expect(summary.facts.partyVotes).toBe(1_898);
    expect(summary.facts.candidatePartyDifference).toBe(2);
    expect(summary.facts.votesCounted).toBe(10_000);
  });

  it('distinguishes a missing place fraction from zero', () => {
    const missing = summarizeCount(seat({ votePercentageCounted: undefined }));
    expect(missing.places.contributingFraction).toBeNull();

    const zero = summarizeCount(seat({ votePercentageCounted: 0 }));
    expect(zero.places.contributingFraction).toBe(0);
    expect(zero.places.contributingReported).toBeNull();
  });

  it('uses the model estimate when one exists', () => {
    const summary = summarizeCount({
      ...seat(),
      chance: countingChance,
      enrolment: 45_407,
    });
    expect(summary.ordinary.state).toBe('counting');
    expect(summary.ordinary.counted).toBe(10_000);
    expect(summary.ordinary.remaining?.value).toBe(15_300);
    expect(summary.ordinary.remaining?.low).toBe(12_000);
    expect(summary.ordinary.remaining?.high).toBe(18_000);
    expect(summary.ordinary.progress).toBe(0.68);
    expect(summary.specials.remaining?.value).toBe(5_000);
    expect(summary.version).toBe(COUNT_SUMMARY_VERSION);
  });

  it('does not let a raw correction be clamped away', () => {
    const higher = summarizeCount({
      result: { votesCounted: 2_000, votePercentageCounted: 0.2 },
      enrolment: 20_000,
      electionYear: 2023,
    });
    const lower = summarizeCount({
      result: { votesCounted: 1_500, votePercentageCounted: 0.15 },
      enrolment: 20_000,
      electionYear: 2023,
    });

    expect(higher.ordinary.counted).toBeGreaterThan(lower.ordinary.counted);
    // Fewer counted votes leave more outstanding and a lower progress; the
    // correction is not clamped to the previous, higher values.
    expect(higher.ordinary.remaining!.value).toBeLessThan(
      lower.ordinary.remaining!.value
    );
    expect(higher.ordinary.progress!).toBeGreaterThan(lower.ordinary.progress!);
  });

  it('ignores the feed final flag until its semantics are validated', () => {
    const unvalidated = summarizeCount({
      result: { votesCounted: 10_000, votePercentageCounted: 1, final: true },
      enrolment: 20_000,
      electionYear: 2023,
    });
    expect(unvalidated.phase).toBe('preliminary-complete');

    const validated = summarizeCount({
      result: { votesCounted: 10_000, votePercentageCounted: 1, final: true },
      enrolment: 20_000,
      electionYear: 2023,
      finalSemantics: 'validated',
    });
    expect(validated.phase).toBe('official');
  });

  it('does not invent outstanding specials on an official result', () => {
    const summary = summarizeCount({
      result: {
        votesCounted: 30_000,
        votePercentageCounted: 1,
        final: true,
        candidateVotes: [{ votes: 30_000 }],
        partyVotes: [{ votes: 30_000 }],
      },
      enrolment: 40_000,
      electionYear: 2023,
      finalSemantics: 'validated',
      chance: countingChance,
    });

    expect(summary.phase).toBe('official');
    expect(summary.ordinary.state).toBe('complete');
    expect(summary.ordinary.remaining?.value).toBe(0);
    expect(summary.specials.remaining).toBeNull();
  });

  it('reports national coverage with unknown seats counted, not dropped', () => {
    const known = {
      result: { votesCounted: 1_000, votePercentageCounted: 0.5 },
      enrolment: 10_000,
      electionYear: 2023,
    };
    const unknown = {
      result: { votesCounted: 500, votePercentageCounted: 0.5 },
      electionYear: 2023,
    };

    const national = summarizeNationalCount([known, unknown]);

    // Both seats' counted votes are in the numerator, the known seat has a
    // denominator, and the unknown seat is reported rather than dropped.
    expect(national.votesCounted).toBe(1_500);
    expect(national.unknownSeats).toBe(1);
    expect(national.expected).toBeGreaterThan(1_500);
    expect(national.fraction).toBeLessThan(1);
  });
});
