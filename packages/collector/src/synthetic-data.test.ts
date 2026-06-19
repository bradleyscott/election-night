import { describe, expect, test } from 'vitest';
import {
  calculateLead,
  predictWinner,
  calculatePartyVoteWithPercentages,
} from '@election-night/core/reducers';
import type { ElectorateResults } from '@election-night/core/types';
import {
  generatePartialResults,
  SCENARIO_LANDSLIDE,
  SCENARIO_STRONG,
  SCENARIO_MARGINAL,
  earlyCountResults,
  midCountResults,
  lateCountResults,
  landslideFixtures,
  strongFixtures,
  marginalFixtures,
  closeFixtures,
  extremelyCloseFixtures,
  tiedFixtures,
} from './synthetic-data';

function buildPartyMap(
  results: ElectorateResults
): Record<string, string | undefined> {
  const map: Record<string, string | undefined> = {};
  for (const cv of results.candidateVotes) {
    map[cv.candidate] = cv.party;
  }
  return map;
}

describe('synthetic data', () => {
  describe('electorate predictions', () => {
    test('predicts a landslide correctly even when candidateVotes are not in vote order', () => {
      const r = landslideFixtures[1.0];
      const shuffled = {
        ...r,
        candidateVotes: [...r.candidateVotes].reverse(),
      };
      const withLead = calculateLead(shuffled, buildPartyMap(shuffled));
      const prediction = predictWinner(withLead, 0.95);

      expect(prediction.leaders.leadingCandidate).toBe('Smith, John');
      expect(prediction.leaders.predictionStatus).toBe('projected');
      expect(prediction.candidateVotes[0].votes).toBeGreaterThan(
        prediction.candidateVotes[1].votes
      );
    });

    const cases = [
      {
        fixtures: landslideFixtures,
        name: 'landslide (National 75%)',
        expected: { 0.1: true, 0.3: true, 0.5: true, 0.8: true, 1.0: true },
      },
      {
        fixtures: strongFixtures,
        name: 'strong Labour (20% margin)',
        expected: { 0.1: true, 0.3: true, 0.5: true, 0.8: true, 1.0: true },
      },
      {
        fixtures: marginalFixtures,
        name: 'marginal National (1% margin)',
        expected: { 0.1: false, 0.3: false, 0.5: false, 0.8: true, 1.0: true },
      },
      {
        fixtures: closeFixtures,
        name: 'close National (0.1% margin)',
        expected: { 0.1: false, 0.3: false, 0.5: false, 0.8: false, 1.0: true },
      },
      {
        fixtures: extremelyCloseFixtures,
        name: 'extremely close Labour (0.013% margin)',
        expected: { 0.1: false, 0.3: false, 0.5: false, 0.8: false, 1.0: true },
      },
      {
        fixtures: tiedFixtures,
        name: 'tied (0% margin)',
        expected: {
          0.1: false,
          0.3: false,
          0.5: false,
          0.8: false,
          1.0: false,
        },
      },
    ];

    for (const { fixtures, name, expected } of cases) {
      for (const [pct, exp] of Object.entries(expected)) {
        test(`${name} at ${+pct * 100}% → predicted=${exp}`, () => {
          const r = fixtures[+pct as unknown as keyof typeof fixtures];
          const withLead = calculateLead(r, buildPartyMap(r));
          const prediction = predictWinner(withLead, 0.95);
          expect(
            prediction.leaders.predictionStatus !== 'too-close'
          ).toBe(exp);
        });
      }
    }
  });

  describe('vote counts scale proportionally', () => {
    const scenarios = [
      { fixtures: landslideFixtures, total: 30_000 },
      { fixtures: strongFixtures, total: 30_000 },
      { fixtures: marginalFixtures, total: 30_000 },
      { fixtures: closeFixtures, total: 30_000 },
      { fixtures: extremelyCloseFixtures, total: 30_000 },
      { fixtures: tiedFixtures, total: 30_000 },
    ];

    for (const { fixtures, total } of scenarios) {
      const PCTS = [0.1, 0.3, 0.5, 0.8, 1.0] as const;
      for (const pct of PCTS) {
        test(`votesCounted = ${Math.round(total * pct)} at ${pct * 100}%`, () => {
          const r = fixtures[pct];
          expect(r.votesCounted).toBe(Math.round(total * pct));
          expect(r.votePercentageCounted).toBe(pct);
        });
      }
    }
  });

  describe('candidate vote sums match votesCounted', () => {
    const allFixtures = [
      landslideFixtures,
      strongFixtures,
      marginalFixtures,
      closeFixtures,
      extremelyCloseFixtures,
      tiedFixtures,
    ];

    for (const fixtures of allFixtures) {
      const PCTS = [0.1, 0.3, 0.5, 0.8, 1.0] as const;
      for (const pct of PCTS) {
        test(`candidate votes sum to votesCounted at ${pct * 100}%`, () => {
          const r = fixtures[pct];
          const total = r.candidateVotes.reduce((s, c) => s + c.votes, 0);
          expect(total).toBe(r.votesCounted);
        });
      }
    }
  });

  describe('party vote sums match votesCounted', () => {
    const allFixtures = [
      landslideFixtures,
      strongFixtures,
      marginalFixtures,
      closeFixtures,
      extremelyCloseFixtures,
      tiedFixtures,
    ];

    for (const fixtures of allFixtures) {
      const PCTS = [0.1, 0.3, 0.5, 0.8, 1.0] as const;
      for (const pct of PCTS) {
        test(`party votes sum to votesCounted at ${pct * 100}%`, () => {
          const r = fixtures[pct];
          const total = r.partyVotes.reduce((s, p) => s + p.votes, 0);
          expect(total).toBe(r.votesCounted);
        });
      }
    }
  });

  describe('national aggregate bias', () => {
    test('National party share declines early → mid → late', () => {
      const early = calculatePartyVoteWithPercentages(earlyCountResults, 0.95);
      const mid = calculatePartyVoteWithPercentages(midCountResults, 0.95);
      const late = calculatePartyVoteWithPercentages(lateCountResults, 0.95);

      const earlyNat = early.find((x) => x.candidate === 'National Party');
      const midNat = mid.find((x) => x.candidate === 'National Party');
      const lateNat = late.find((x) => x.candidate === 'National Party');

      expect(midNat!.percentage).toBeLessThan(earlyNat!.percentage);
      expect(lateNat!.percentage).toBeLessThan(midNat!.percentage);
    });

    test('Labour party share increases early → mid → late', () => {
      const early = calculatePartyVoteWithPercentages(earlyCountResults, 0.95);
      const mid = calculatePartyVoteWithPercentages(midCountResults, 0.95);
      const late = calculatePartyVoteWithPercentages(lateCountResults, 0.95);

      const earlyLab = early.find((x) => x.candidate === 'Labour Party');
      const midLab = mid.find((x) => x.candidate === 'Labour Party');
      const lateLab = late.find((x) => x.candidate === 'Labour Party');

      expect(midLab!.percentage).toBeGreaterThan(earlyLab!.percentage);
      expect(lateLab!.percentage).toBeGreaterThan(midLab!.percentage);
    });
  });

  describe('tied electorate', () => {
    const PCTS = [0.1, 0.3, 0.5, 0.8, 1.0] as const;
    for (const pct of PCTS) {
      test(`margin is 0 at ${pct * 100}%`, () => {
        const result = tiedFixtures[pct];
        const withLead = calculateLead(result, buildPartyMap(result));
        expect(withLead.leaders.margin).toBe(0);
      });
    }

    for (const pct of PCTS) {
      test(`no predicted winner at ${pct * 100}%`, () => {
        const r = tiedFixtures[pct];
        const withLead = calculateLead(r, buildPartyMap(r));
        const result = predictWinner(withLead, 0.95);
        expect(result.leaders.predictionStatus).toBe('too-close');
      });
    }
  });

  describe('generatePartialResults custom pct', () => {
    test('votesCounted at 25%', () => {
      const r = generatePartialResults(SCENARIO_LANDSLIDE, 0.25);
      expect(r.votesCounted).toBe(7500);
      expect(r.votePercentageCounted).toBe(0.25);
    });

    test('votesCounted at 67%', () => {
      const r = generatePartialResults(SCENARIO_LANDSLIDE, 0.67);
      expect(r.votesCounted).toBe(20100);
      expect(r.votePercentageCounted).toBe(0.67);
    });

    test('candidate votes sum at 37%', () => {
      const r = generatePartialResults(SCENARIO_STRONG, 0.37);
      const total = r.candidateVotes.reduce((s, c) => s + c.votes, 0);
      expect(total).toBe(r.votesCounted);
    });

    test('party votes sum at 62%', () => {
      const r = generatePartialResults(SCENARIO_MARGINAL, 0.62);
      const total = r.partyVotes.reduce((s, p) => s + p.votes, 0);
      expect(total).toBe(r.votesCounted);
    });
  });
});
