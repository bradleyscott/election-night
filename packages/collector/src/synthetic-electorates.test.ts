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

/** 2020 and 2023 were fought on the same boundaries. */
function boundaryYear(year: MockElectionYear): string {
  return year === '2020' ? '2023' : year;
}

/** The party that led a full-stage seat, or undefined for a tie. */
function winnerParty(
  results: ReturnType<typeof buildMockElectionSet>['stages']['full'],
  name: string
): string | undefined {
  const result = results.find((r) => r.electorateName === name);
  if (!result) throw new Error(`no full-stage result for ${name}`);
  return [...result.candidateVotes].sort((a, b) => b.votes - a.votes)[0]?.party;
}

describe('mock electorate sets', () => {
  test('default year is one of the supported cycles', () => {
    expect(MOCK_ELECTION_YEARS).toContain(DEFAULT_MOCK_ELECTION_YEAR);
    expect(MOCK_ELECTION_YEARS).toEqual(['2020', '2023', '2026']);
    expect(isMockElectionYear('2026')).toBe(true);
    expect(isMockElectionYear('2017')).toBe(false);
  });

  test('2020 and 2023 have 65 general + 7 Māori electorates', () => {
    for (const year of ['2020', '2023'] as const) {
      expect(MOCK_ELECTORATE_SETS[year].general).toHaveLength(65);
      expect(MOCK_ELECTORATE_SETS[year].maori).toHaveLength(7);
    }
  });

  test('2026 has 64 general + 7 Māori electorates', () => {
    expect(MOCK_ELECTORATE_SETS['2026'].general).toHaveLength(64);
    expect(MOCK_ELECTORATE_SETS['2026'].maori).toHaveLength(7);
  });

  test('2020 and 2023 share one electorate list', () => {
    expect(MOCK_ELECTORATE_SETS['2020']).toEqual(MOCK_ELECTORATE_SETS['2023']);
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
      const boundaries = manifest.years[boundaryYear(year)];
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
        expect(set.electorates.map((e) => e.eNo)).toEqual(
          expectedNames.map((_, index) => index + 1)
        );
        expect(set.year).toBe<MockElectionYear>(year);
      });

      test('gives every electorate candidates with unique names', () => {
        for (const electorate of set.electorates) {
          expect(
            electorate.candidates.length,
            electorate.name
          ).toBeGreaterThanOrEqual(2);
          const names = electorate.candidates.map((c) => c.name);
          expect(new Set(names).size, electorate.name).toBe(names.length);
        }
      });

      test('publishes real party-list candidates, including list-only ones', () => {
        expect(set.listCandidates.length).toBeGreaterThan(0);
        for (const candidate of set.listCandidates) {
          expect(candidate.eNo).toBe(0);
          expect(candidate.listNo).toBeGreaterThan(0);
        }
        // Every electorate candidate also has an electorate number.
        for (const candidate of set.candidates) {
          expect(candidate.eNo).toBeGreaterThanOrEqual(0);
          expect(candidate.eNo).toBeLessThanOrEqual(set.electorates.length);
        }
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
        // The national total and the sum of the seat files differ by a handful
        // of papers in the feed itself; a replay must not invent a bigger gap.
        expect(
          Math.abs(total('full') - set.election.totalVotesCast)
        ).toBeLessThan(set.election.totalVotesCast * 0.001);
      });

      test('the full stage keeps the real seat-by-seat winners', () => {
        const expected: Record<string, string> = {
          // These are the published results, not a pattern assigned at random.
          Epsom: 'ACT New Zealand',
          Māngere: 'Labour Party',
          'Te Tai Tokerau': year === '2020' ? 'Labour Party' : 'Te Pāti Māori',
          'Ikaroa-Rāwhiti': 'Labour Party',
        };
        for (const [seat, party] of Object.entries(expected)) {
          expect(winnerParty(set.stages.full, seat), seat).toBe(party);
        }
        // Tāmaki changed hands: National in 2020, ACT in 2023, National in 2026.
        expect(winnerParty(set.stages.full, 'Tāmaki')).toBe(
          year === '2023' ? 'ACT New Zealand' : 'National Party'
        );
      });

      test('candidate and party votes leave room for informal papers', () => {
        for (const result of set.stages.full) {
          const candidateSum = result.candidateVotes.reduce(
            (sum, c) => sum + c.votes,
            0
          );
          const partySum = result.partyVotes.reduce(
            (sum, p) => sum + p.votes,
            0
          );
          expect(
            candidateSum,
            `${result.electorateName} candidates`
          ).toBeLessThanOrEqual(result.votesCounted);
          expect(
            partySum,
            `${result.electorateName} parties`
          ).toBeLessThanOrEqual(result.votesCounted);
          // Informals are a slice, not a hole in the result. Some Māori seats
          // run above 5%, so the bound is deliberately loose.
          expect(result.votesCounted - candidateSum).toBeLessThan(
            result.votesCounted * 0.1
          );
          expect(result.votesCounted - partySum).toBeLessThan(
            result.votesCounted * 0.1
          );
        }
      });

      test('the full party vote matches the published national table', () => {
        const totals = new Map<string, number>();
        for (const result of set.stages.full) {
          for (const party of result.partyVotes) {
            totals.set(
              party.candidate,
              (totals.get(party.candidate) ?? 0) + party.votes
            );
          }
        }
        const partyNames = new Map(set.parties.map((p) => [p.pNo, p.name]));
        for (const official of set.election.parties) {
          const name = partyNames.get(official.pNo);
          if (!name) continue;
          expect(totals.get(name) ?? 0, name).toBe(official.votes);
        }
      });

      test('reports believable turnout, not counting progress', () => {
        for (const result of set.stages.full) {
          expect(
            result.percentVotesCast,
            result.electorateName
          ).toBeGreaterThan(0.3);
          expect(
            result.percentVotesCast,
            result.electorateName
          ).toBeLessThanOrEqual(1);
        }
        const enrolment = [...set.enrolmentByElectorate.values()].reduce(
          (sum, value) => sum + value,
          0
        );
        expect(enrolment).toBeGreaterThan(0);
      });

      test('general electorates are not all won by one party', () => {
        const general = new Set(MOCK_ELECTORATE_SETS[year].general);
        const winners = new Set(
          set.stages.full
            .filter((r) => general.has(r.electorateName))
            .map((r) => {
              const leader = [...r.candidateVotes].sort(
                (a, b) => b.votes - a.votes
              )[0];
              return leader?.party;
            })
        );
        expect(winners.size).toBeGreaterThan(2);
      });

      test('publishes a parliament of at least 120 seats', () => {
        const seats = set.election.parties.reduce(
          (sum, party) => sum + party.totalSeats,
          0
        );
        expect(seats).toBeGreaterThanOrEqual(120);
      });

      test('says when polling day was', () => {
        expect(set.pollingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  }

  test('replaying a cycle is deterministic', () => {
    // The mock used to shuffle pattern assignment on every call, which made a
    // failing test impossible to reproduce. A replay now serves the same seat,
    // candidate and winner every time.
    const a = buildMockElectionSet('2026');
    const b = buildMockElectionSet('2026');
    const leaders = (set: typeof a) =>
      set.stages.full.map((r) => {
        const leader = [...r.candidateVotes].sort(
          (x, y) => y.votes - x.votes
        )[0];
        return `${r.electorateName}:${leader?.candidate}:${leader?.votes}`;
      });
    expect(leaders(a)).toEqual(leaders(b));
    expect(a.stages.full.map((r) => r.votesCounted)).toEqual(
      b.stages.full.map((r) => r.votesCounted)
    );
  });
});
