import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  resolveEnrolment,
  specialRatioForSeat,
  seatChanceFor,
  type NotionalBaseline,
} from './notional-baseline.js';
import type { ElectorateResult } from './types.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
const baseline = async (target: string) =>
  JSON.parse(
    await readFile(resolve(DATA, `notional-baseline-${target}.json`), 'utf8')
  ) as NotionalBaseline;

/**
 * Enrolment is the denominator every progress number divides by, so the choice
 * between the baseline's figure and the one tonight's turnout implies decides
 * whether a seat looks nearly counted or barely started. The rules are pinned
 * here rather than left to whichever call site happens to hold a payload.
 */
/** The share of a seat's vote that arrives after election night is not uniform. */
describe('special-vote ratios', () => {
  it('carries a ratio for every seat that has its own previous result', async () => {
    for (const [target, source] of [
      ['2023', '2020'],
      ['2026', '2023'],
    ] as const) {
      const base = await baseline(target);
      expect(base.sourceYear).toBe(Number(source));
      for (const [name, seat] of Object.entries(base.seats)) {
        if (seat.method === 'same-name') {
          expect(seat.specialRatio, `${target}: ${name}`).toBeGreaterThan(0);
        } else {
          // Place geometry cannot find a special vote, so a seat with no source
          // result has no basis for a ratio and must say so rather than imply 1.
          expect(seat.specialRatio, `${target}: ${name}`).toBeNull();
        }
      }
    }
  });

  it('brackets every seat close to the national share', async () => {
    // Not a tolerance for its own sake: a ratio outside this band would mean the
    // join picked up the wrong electorate, and the model would move a seat's
    // specials by more than the seat's own 2023 result supports (the widest was
    // Auckland Central at 1.66).
    const base = await baseline('2026');
    const ratios = Object.values(base.seats)
      .map((seat) => seat.specialRatio)
      .filter((ratio): ratio is number => typeof ratio === 'number');
    expect(ratios.length).toBeGreaterThan(60);
    expect(Math.min(...ratios)).toBeGreaterThan(0.5);
    expect(Math.max(...ratios)).toBeLessThan(1.8);
  });

  it('puts the city and Māori seats high and the stable rural seats low', async () => {
    const base = await baseline('2026');
    expect(specialRatioForSeat(base, 'Auckland Central')).toBeCloseTo(
      1.6573,
      3
    );
    expect(specialRatioForSeat(base, 'Ōtāhuhu')).toBeCloseTo(1.5983, 3);
    expect(specialRatioForSeat(base, 'Invercargill')).toBeLessThan(0.7);
    // Every Māori seat was above the national share in both archived cycles.
    for (const name of [
      'Te Tai Tokerau',
      'Tāmaki Makaurau',
      'Hauraki-Waikato',
      'Waiariki',
      'Ikaroa-Rāwhiti',
      'Te Tai Hauāuru',
      'Te Tai Tonga',
    ]) {
      expect(specialRatioForSeat(base, name), name).toBeGreaterThan(1);
    }
  });

  it('gives a renamed seat its predecessor’s ratio', async () => {
    const base = await baseline('2026');
    // The rename table says these are the same seat, so the special-vote
    // history has to travel with the name — a renamed seat is not a new seat.
    expect(base.seats['Wellington North'].carriedFrom).toBe(
      'Wellington Central'
    );
    expect(specialRatioForSeat(base, 'Wellington North')).toBeCloseTo(
      1.3912,
      3
    );
    expect(specialRatioForSeat(base, 'Mt Maunganui')).toBeCloseTo(0.8886, 3);
  });

  it('returns null for a seat with no record, not one', () => {
    expect(specialRatioForSeat(null, 'Auckland Central')).toBeNull();
    expect(
      specialRatioForSeat(
        { seats: {} } as unknown as NotionalBaseline,
        'Nowhere'
      )
    ).toBeNull();
  });

  it('reaches the model through seatChanceFor', async () => {
    const base = await baseline('2026');
    const seat = (name: string): ElectorateResult => ({
      electorateName: name,
      partyVotes: [],
      candidateVotes: [
        { candidate: 'A', party: 'National Party', votes: 17_000 },
        { candidate: 'B', party: 'Labour Party', votes: 13_000 },
      ],
      votesCounted: 30_000,
      votePercentageCounted: 0.6,
      percentVotesCast: 0.3,
      leaders: {
        leadingCandidate: 'A',
        leadingCandidateParty: 'National Party',
        secondCandidate: 'B',
        secondCandidateParty: 'Labour Party',
        margin: 4_000,
        marginPercent: 0.13,
      },
    });

    const auckland = seatChanceFor(seat('Auckland Central'), base, {}, 2026);
    const invercargill = seatChanceFor(seat('Invercargill'), base, {}, 2026);
    if (auckland.state !== 'counting' || invercargill.state !== 'counting') {
      throw new Error('expected two live counts');
    }
    // Same margin and same count, different seat: the specials are the only
    // thing that can tell these two apart, and the ratio is what carries it.
    expect(invercargill.specialsOutstanding).toBeLessThan(
      auckland.specialsOutstanding
    );
    expect(auckland.insideSpecials).toBe(true);
    expect(invercargill.insideSpecials).toBe(false);
  });
});

describe('resolveEnrolment', () => {
  it('uses the recorded roll while the derivation is too coarse to judge', () => {
    // 400 votes at "1.7%" is 23,529 enrolled by division and 45,407 in fact:
    // the feed publishes turnout to one decimal place, so early on the derived
    // figure is arithmetic noise. The recorded roll wins.
    expect(
      resolveEnrolment({
        recorded: 45_407,
        votesCounted: 400,
        percentVotesCast: 0.017,
      })
    ).toBe(45_407);
  });

  it('prefers tonight’s turnout once the two disagree materially', () => {
    // Ōtāhuhu's baseline roll is 21,254 because place geometry only found the
    // ballots cast inside the seat. 30,000 votes at 61% turnout implies 49,180
    // enrolled, which is the real seat and too far from 21,254 to be rounding.
    expect(
      resolveEnrolment({
        recorded: 21_254,
        votesCounted: 30_000,
        percentVotesCast: 0.61,
      })
    ).toBeCloseTo(30_000 / 0.61, 6);
  });

  it('keeps the recorded roll when the two agree', () => {
    expect(
      resolveEnrolment({
        recorded: 45_407,
        votesCounted: 27_000,
        percentVotesCast: 0.6,
      })
    ).toBe(45_407);
  });

  it('falls back to whichever one it has', () => {
    expect(
      resolveEnrolment({ votesCounted: 900, percentVotesCast: 0.2 })
    ).toBeCloseTo(4_500, 6);
    expect(resolveEnrolment({ recorded: 45_407 })).toBe(45_407);
    expect(resolveEnrolment({})).toBeNull();
    expect(resolveEnrolment({ recorded: 0, votesCounted: 0 })).toBeNull();
  });
});
