import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';
import {
  buildMockElectionSet,
  MOCK_ELECTION_YEARS,
  MOCK_ELECTORATE_SETS,
  DEFAULT_MOCK_ELECTION_YEAR,
  isMockElectionYear,
  type MockElectionYear,
} from './synthetic-electorates.js';

const BOUNDARY_MANIFEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../dashboard/public/boundaries/index.json'
);

type Manifest = {
  years: Record<string, { general?: string[]; maori?: string[] }>;
};

function readBoundaryManifest(): Manifest {
  return JSON.parse(readFileSync(BOUNDARY_MANIFEST, 'utf8')) as Manifest;
}

describe('mock electorate sets', () => {
  test('default year is one of the supported cycles', () => {
    expect(MOCK_ELECTION_YEARS).toContain(DEFAULT_MOCK_ELECTION_YEAR);
    expect(isMockElectionYear('2026')).toBe(true);
    expect(isMockElectionYear('2017')).toBe(false);
  });

  test('2023 has 65 general + 7 Māori electorates', () => {
    expect(MOCK_ELECTORATE_SETS['2023'].general).toHaveLength(65);
    expect(MOCK_ELECTORATE_SETS['2023'].maori).toHaveLength(7);
  });

  test('2026 has 64 general + 7 Māori electorates', () => {
    expect(MOCK_ELECTORATE_SETS['2026'].general).toHaveLength(64);
    expect(MOCK_ELECTORATE_SETS['2026'].maori).toHaveLength(7);
  });

  test('2026 drops the abolished electorates and adds the new ones', () => {
    const general = new Set(MOCK_ELECTORATE_SETS['2026'].general);
    for (const name of [
      'Kapiti',
      'Kenepuru',
      'Glendene',
      'Henderson',
      'Waitākere',
      'Ōtāhuhu',
      'Mt Maunganui',
      'East Cape',
      'Wellington North',
      'Wellington Bays',
    ]) {
      expect(general, `${name} should exist in 2026`).toContain(name);
    }
    for (const name of [
      'Ōtaki',
      'Mana',
      'Ōhāriu',
      'Kelston',
      'New Lynn',
      'Te Atatū',
      'Panmure-Ōtāhuhu',
      'Rongotai',
      'Wellington Central',
      'East Coast',
      'Bay of Plenty',
    ]) {
      expect(general, `${name} should be gone in 2026`).not.toContain(name);
    }
  });

  /**
   * The mock's whole point is to drive the dashboard. If it serves an
   * electorate the boundary map has no polygon for, the map cannot colour it —
   * and if the names drift by a macron (`Whāngārei` vs `Whangārei`) the
   * mismatch is invisible until someone is staring at a grey electorate on
   * election night. Assert against the manifest the client actually loads.
   */
  test('every mock year matches the boundary manifest the map draws from', () => {
    const manifest = readBoundaryManifest();
    for (const year of MOCK_ELECTION_YEARS) {
      const boundaries = manifest.years[year];
      expect(boundaries, `${year} boundaries should exist`).toBeDefined();
      const mock = MOCK_ELECTORATE_SETS[year];
      expect(new Set(mock.general), `${year} general`).toEqual(
        new Set(boundaries!.general)
      );
      expect(new Set(mock.maori), `${year} maori`).toEqual(
        new Set(boundaries!.maori)
      );
      expect(mock.general).toHaveLength(boundaries!.general!.length);
      expect(mock.maori).toHaveLength(boundaries!.maori!.length);
    }
  });

  test('general and Māori electorate names do not overlap', () => {
    for (const year of MOCK_ELECTION_YEARS) {
      const { general, maori } = MOCK_ELECTORATE_SETS[year];
      const overlap = general.filter((name) => maori.includes(name));
      expect(overlap, `${year} overlap`).toEqual([]);
    }
  });
});

describe('buildMockElectionSet', () => {
  const stageNames = ['early', 'mid', 'late', 'full'] as const;

  for (const year of MOCK_ELECTION_YEARS) {
    describe(year, () => {
      const set = buildMockElectionSet(year);
      const expectedNames = [
        ...MOCK_ELECTORATE_SETS[year].general,
        ...MOCK_ELECTORATE_SETS[year].maori,
      ];

      test('numbers electorates general-first, then Māori', () => {
        expect(set.electorates.map((e) => e.name)).toEqual(expectedNames);
        expect(set.year).toBe<MockElectionYear>(year);
      });

      test('gives every electorate at least two candidates', () => {
        for (const electorate of set.electorates) {
          expect(
            electorate.candidates.length,
            electorate.name
          ).toBeGreaterThanOrEqual(2);
        }
      });

      test('uses unique candidate names feed-wide', () => {
        const names = set.electorates.flatMap((e) =>
          e.candidates.map((c) => c.name)
        );
        expect(new Set(names).size).toBe(names.length);
      });

      for (const stage of stageNames) {
        test(`stage "${stage}" covers every electorate exactly once`, () => {
          const results = set.stages[stage];
          const names = results.map((r) => r.electorateName);
          expect(names).toHaveLength(expectedNames.length);
          expect(new Set(names)).toEqual(new Set(expectedNames));
        });
      }

      test('counting progresses early → mid → late → full', () => {
        const total = (stage: (typeof stageNames)[number]) =>
          set.stages[stage].reduce((sum, r) => sum + r.votesCounted, 0);
        expect(total('early')).toBeLessThan(total('mid'));
        expect(total('mid')).toBeLessThan(total('late'));
        expect(total('late')).toBeLessThan(total('full'));
      });

      test('every Māori electorate is led by Te Pāti Māori', () => {
        // The Māori pattern is pinned to the Māori electorates, so Te Pāti
        // Māori wins all seven — which is what produces an overhang and pushes
        // parliament past 120 seats, the case worth exercising.
        for (const name of MOCK_ELECTORATE_SETS[year].maori) {
          const result = set.stages.full.find((r) => r.electorateName === name);
          expect(result, name).toBeDefined();
          const leader = [...result!.candidateVotes].sort(
            (a, b) => b.votes - a.votes
          )[0];
          expect(leader?.party, `${name} leader`).toBe('Te Pāti Māori');
        }
      });

      test('candidate votes and party votes each sum to the votes counted', () => {
        for (const result of set.stages.full) {
          const candidateSum = result.candidateVotes.reduce(
            (sum, c) => sum + c.votes,
            0
          );
          const partySum = result.partyVotes.reduce(
            (sum, p) => sum + p.votes,
            0
          );
          expect(candidateSum, `${result.electorateName} candidates`).toBe(
            result.votesCounted
          );
          expect(partySum, `${result.electorateName} parties`).toBe(
            result.votesCounted
          );
        }
      });
    });
  }

  test('builds a fresh, independently shuffled set on each call', () => {
    // Pattern assignment is shuffled, so a 2026 run does not always pit the
    // same parties against each other in the same electorates.
    const a = buildMockElectionSet('2026');
    const b = buildMockElectionSet('2026');
    const leaders = (set: typeof a) =>
      set.stages.full.map((r) => {
        const leader = [...r.candidateVotes].sort(
          (x, y) => y.votes - x.votes
        )[0];
        return `${r.electorateName}:${leader?.party}`;
      });
    expect(new Set(leaders(a))).not.toEqual(new Set(leaders(b)));
  });

  test('2026 general electorates are not all won by the same party', () => {
    const set = buildMockElectionSet('2026');
    const general = new Set(MOCK_ELECTORATE_SETS['2026'].general);
    const winners = new Set(
      set.stages.full
        .filter((r) => general.has(r.electorateName))
        .map((r) => {
          const leader = [...r.candidateVotes].sort(
            (x, y) => y.votes - x.votes
          )[0];
          return leader?.party;
        })
    );
    expect(winners.size).toBeGreaterThan(2);
  });
});
