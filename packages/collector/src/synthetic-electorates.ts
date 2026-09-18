import {
  generatePartialResults,
  type SyntheticElectorate,
} from './synthetic-data.js';
import type { ElectorateResults } from '@election-night/core/types';

type CandidateInfo = { name: string; party?: string };

/** Parties used by the mock. `abbrev` is used when serializing mock XML. */
export const MOCK_PARTIES: { name: string; abbrev: string }[] = [
  { name: 'National Party', abbrev: 'NAT' },
  { name: 'Labour Party', abbrev: 'LAB' },
  { name: 'Green Party', abbrev: 'GP' },
  { name: 'ACT New Zealand', abbrev: 'ACT' },
  { name: 'New Zealand First Party', abbrev: 'NZF' },
  { name: 'Te Pāti Māori', abbrev: 'TPM' },
  { name: 'The Opportunities Party (TOP)', abbrev: 'TOP' },
];

/** Election cycles the mock can replay. */
export type MockElectionYear = '2023' | '2026';

export const MOCK_ELECTION_YEARS: readonly MockElectionYear[] = [
  '2023',
  '2026',
];

export const DEFAULT_MOCK_ELECTION_YEAR: MockElectionYear = '2023';

export function isMockElectionYear(value: string): value is MockElectionYear {
  return (MOCK_ELECTION_YEARS as readonly string[]).includes(value);
}

/**
 * Electorate names per cycle, split general/Māori in the order the Electoral
 * Commission's `electorates.xml` uses (general first, then Māori), so the
 * mock's `e_no` numbering matches the real feed.
 *
 * 2026 uses the Representation Commission's final 2025 boundaries: 64 general
 * electorates instead of 65, with 10 renamed or new (Kapiti, Kenepuru,
 * Glendene, Henderson, Waitākere, Ōtāhuhu, Mt Maunganui, East Cape, Wellington
 * North, Wellington Bays) and 11 abolished (Ōtaki, Mana, Ōhāriu, Kelston,
 * New Lynn, Te Atatū, Panmure-Ōtāhuhu, Rongotai, Wellington Central, East
 * Coast, Bay of Plenty).
 *
 * `synthetic-electorates.test.ts` asserts these lists match the boundary
 * manifest the dashboard map draws from, so the mock cannot serve electorates
 * the map has no polygon for.
 */
export const MOCK_ELECTORATE_SETS: Record<
  MockElectionYear,
  { general: string[]; maori: string[] }
> = {
  '2023': {
    general: [
      'Auckland Central',
      'Banks Peninsula',
      'Bay of Plenty',
      'Botany',
      'Christchurch Central',
      'Christchurch East',
      'Coromandel',
      'Dunedin',
      'East Coast',
      'East Coast Bays',
      'Epsom',
      'Hamilton East',
      'Hamilton West',
      'Hutt South',
      'Ilam',
      'Invercargill',
      'Kaikōura',
      'Kaipara ki Mahurangi',
      'Kelston',
      'Mana',
      'Māngere',
      'Manurewa',
      'Maungakiekie',
      'Mt Albert',
      'Mt Roskill',
      'Napier',
      'Nelson',
      'New Lynn',
      'New Plymouth',
      'North Shore',
      'Northcote',
      'Northland',
      'Ōhāriu',
      'Ōtaki',
      'Pakuranga',
      'Palmerston North',
      'Panmure-Ōtāhuhu',
      'Papakura',
      'Port Waikato',
      'Rangitata',
      'Rangitīkei',
      'Remutaka',
      'Rongotai',
      'Rotorua',
      'Selwyn',
      'Southland',
      'Taieri',
      'Takanini',
      'Tāmaki',
      'Taranaki-King Country',
      'Taupō',
      'Tauranga',
      'Te Atatū',
      'Tukituki',
      'Upper Harbour',
      'Waikato',
      'Waimakariri',
      'Wairarapa',
      'Waitaki',
      'Wellington Central',
      'West Coast-Tasman',
      'Whanganui',
      'Whangaparāoa',
      'Whangārei',
      'Wigram',
    ],
    maori: [
      'Hauraki-Waikato',
      'Ikaroa-Rāwhiti',
      'Tāmaki Makaurau',
      'Te Tai Hauāuru',
      'Te Tai Tokerau',
      'Te Tai Tonga',
      'Waiariki',
    ],
  },
  '2026': {
    general: [
      'Auckland Central',
      'Banks Peninsula',
      'Botany',
      'Christchurch Central',
      'Christchurch East',
      'Coromandel',
      'Dunedin',
      'East Cape',
      'East Coast Bays',
      'Epsom',
      'Glendene',
      'Hamilton East',
      'Hamilton West',
      'Henderson',
      'Hutt South',
      'Ilam',
      'Invercargill',
      'Kaikōura',
      'Kaipara ki Mahurangi',
      'Kapiti',
      'Kenepuru',
      'Māngere',
      'Manurewa',
      'Maungakiekie',
      'Mt Albert',
      'Mt Maunganui',
      'Mt Roskill',
      'Napier',
      'Nelson',
      'New Plymouth',
      'North Shore',
      'Northcote',
      'Northland',
      'Ōtāhuhu',
      'Pakuranga',
      'Palmerston North',
      'Papakura',
      'Port Waikato',
      'Rangitata',
      'Rangitīkei',
      'Remutaka',
      'Rotorua',
      'Selwyn',
      'Southland',
      'Taieri',
      'Takanini',
      'Tāmaki',
      'Taranaki-King Country',
      'Taupō',
      'Tauranga',
      'Tukituki',
      'Upper Harbour',
      'Waikato',
      'Waimakariri',
      'Wairarapa',
      'Waitākere',
      'Waitaki',
      'Wellington Bays',
      'Wellington North',
      'West Coast-Tasman',
      'Whanganui',
      'Whangaparāoa',
      'Whangārei',
      'Wigram',
    ],
    maori: [
      'Hauraki-Waikato',
      'Ikaroa-Rāwhiti',
      'Tāmaki Makaurau',
      'Te Tai Hauāuru',
      'Te Tai Tokerau',
      'Te Tai Tonga',
      'Waiariki',
    ],
  },
};

const SURNAMES = [
  'SMITH',
  'JOHNSON',
  'WILLIAMS',
  'BROWN',
  'JONES',
  'MILLER',
  'DAVIS',
  'WILSON',
  'TAYLOR',
  'MOORE',
  'ANDERSON',
  'THOMAS',
  'JACKSON',
  'WHITE',
  'HARRIS',
  'MARTIN',
  'THOMPSON',
  'GARCIA',
  'MARTINEZ',
  'ROBINSON',
  'CLARK',
  'LEWIS',
  'WALKER',
  'HALL',
  'YOUNG',
  'KING',
  'WRIGHT',
  'SCOTT',
  'GREEN',
  'BAKER',
];

const GIVEN_NAMES = [
  'Alex',
  'Bailey',
  'Cameron',
  'Dana',
  'Eden',
  'Frankie',
  'Gray',
  'Harper',
  'Indigo',
  'Jamie',
  'Kai',
  'Logan',
  'Mackenzie',
  'Nova',
  'Oakley',
  'Parker',
  'Quinn',
  'Riley',
  'Sage',
  'Taylor',
  'Uma',
  'Val',
  'Wren',
  'Xan',
  'Yuki',
  'Zoe',
];

/** Deterministic, collision-free within the first 780 candidates. */
function mockCandidateName(n: number): string {
  const surname = SURNAMES[n % SURNAMES.length];
  const given =
    GIVEN_NAMES[Math.floor(n / SURNAMES.length) % GIVEN_NAMES.length];
  const cycle = Math.floor(n / (SURNAMES.length * GIVEN_NAMES.length));
  return `${surname}${cycle > 0 ? ` ${cycle + 1}` : ''}, ${given}`;
}

export type MockElectorate = { name: string; candidates: CandidateInfo[] };

/**
 * Build the mock's electorate list (and its candidates) for one cycle.
 *
 * Candidate names are derived from the flat index so they stay unique across
 * the whole feed, which is what lets the mock resolve a candidate back to its
 * `c_no` when serializing results.
 */
function buildElectorates(set: {
  general: string[];
  maori: string[];
}): MockElectorate[] {
  return [...set.general, ...set.maori].map((name, i) => {
    const candidates: CandidateInfo[] = MOCK_PARTIES.map((party, k) => ({
      name: mockCandidateName(i * 10 + k),
      party: party.name,
    }));
    candidates.push({ name: mockCandidateName(i * 10 + 7) });
    if (i % 3 === 0) candidates.push({ name: mockCandidateName(i * 10 + 8) });
    return { name, candidates };
  });
}

type VotePattern = {
  weight: Record<string, number>;
  partyVoteWeight?: Record<string, number>;
  defaultWeight: number;
  independentsWeight: number;
};

const PATTERN_SAFE_NATIONAL: VotePattern = {
  weight: {
    'National Party': 58,
    'Labour Party': 18,
    'Green Party': 7,
    'ACT New Zealand': 8,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 52,
    'Labour Party': 14,
    'Green Party': 9,
    'ACT New Zealand': 11,
    'New Zealand First Party': 7,
    'Te Pāti Māori': 0.5,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.5,
  independentsWeight: 0.3,
};

const PATTERN_STRONG_NATIONAL: VotePattern = {
  weight: {
    'National Party': 48,
    'Labour Party': 25,
    'Green Party': 10,
    'ACT New Zealand': 9,
    'New Zealand First Party': 6,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 46,
    'Labour Party': 18,
    'Green Party': 9,
    'ACT New Zealand': 10,
    'New Zealand First Party': 7,
    'Te Pāti Māori': 0.5,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.7,
  independentsWeight: 0.5,
};

const PATTERN_LEAN_NATIONAL: VotePattern = {
  weight: {
    'National Party': 41,
    'Labour Party': 29,
    'Green Party': 12,
    'ACT New Zealand': 9,
    'New Zealand First Party': 6,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 42,
    'Labour Party': 22,
    'Green Party': 10,
    'ACT New Zealand': 8,
    'New Zealand First Party': 7,
    'Te Pāti Māori': 1,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.7,
  independentsWeight: 0.5,
};

const PATTERN_LEAN_LABOUR: VotePattern = {
  weight: {
    'Labour Party': 40,
    'National Party': 32,
    'Green Party': 15,
    'ACT New Zealand': 5,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 3,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 30,
    'Labour Party': 33,
    'Green Party': 11,
    'ACT New Zealand': 6,
    'New Zealand First Party': 6,
    'Te Pāti Māori': 1,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.7,
  independentsWeight: 0.5,
};

const PATTERN_LABOUR_STRONGHOLD: VotePattern = {
  weight: {
    'Labour Party': 50,
    'National Party': 18,
    'Green Party': 14,
    'ACT New Zealand': 4,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 6,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 20,
    'Labour Party': 44,
    'Green Party': 11,
    'ACT New Zealand': 4,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.5,
  independentsWeight: 0.3,
};

const PATTERN_ACT_STRONGHOLD: VotePattern = {
  weight: {
    'ACT New Zealand': 40,
    'National Party': 22,
    'Labour Party': 20,
    'Green Party': 9,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 3,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 30,
    'Labour Party': 16,
    'Green Party': 9,
    'ACT New Zealand': 32,
    'New Zealand First Party': 6,
    'Te Pāti Māori': 0.5,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.6,
  independentsWeight: 0.4,
};

const PATTERN_MAORI_ELECTORATE: VotePattern = {
  weight: {
    'Te Pāti Māori': 40,
    'Labour Party': 28,
    'National Party': 15,
    'Green Party': 8,
    'ACT New Zealand': 3,
    'New Zealand First Party': 3,
    'The Opportunities Party (TOP)': 0.5,
  },
  partyVoteWeight: {
    'National Party': 18,
    'Labour Party': 28,
    'Green Party': 10,
    'ACT New Zealand': 2,
    'New Zealand First Party': 3,
    'Te Pāti Māori': 28,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.4,
  independentsWeight: 0.3,
};

const PATTERN_MARGINAL: VotePattern = {
  weight: {
    'National Party': 39,
    'Labour Party': 28,
    'Green Party': 13,
    'ACT New Zealand': 10,
    'New Zealand First Party': 6,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 39,
    'Labour Party': 26,
    'Green Party': 11,
    'ACT New Zealand': 9,
    'New Zealand First Party': 6,
    'Te Pāti Māori': 1,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.8,
  independentsWeight: 0.6,
};

const PATTERN_VERY_CLOSE: VotePattern = {
  weight: {
    'National Party': 43,
    'Labour Party': 42,
    'Green Party': 11,
    'ACT New Zealand': 8,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 37,
    'Labour Party': 31,
    'Green Party': 11,
    'ACT New Zealand': 7,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 1,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.7,
  independentsWeight: 0.5,
};

const PATTERN_PHOTO_FINISH: VotePattern = {
  weight: {
    'National Party': 47,
    'Labour Party': 46,
    'Green Party': 10,
    'ACT New Zealand': 7,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 35,
    'Labour Party': 34,
    'Green Party': 10,
    'ACT New Zealand': 7,
    'New Zealand First Party': 5,
    'Te Pāti Māori': 1,
    'The Opportunities Party (TOP)': 1,
  },
  defaultWeight: 0.7,
  independentsWeight: 0.5,
};

const PATTERN_GREEN_URBAN: VotePattern = {
  weight: {
    'Green Party': 40,
    'Labour Party': 28,
    'National Party': 22,
    'ACT New Zealand': 5,
    'New Zealand First Party': 3,
    'Te Pāti Māori': 2,
    'The Opportunities Party (TOP)': 1,
  },
  partyVoteWeight: {
    'National Party': 18,
    'Labour Party': 24,
    'Green Party': 34,
    'ACT New Zealand': 4,
    'New Zealand First Party': 3,
    'Te Pāti Māori': 1,
    'The Opportunities Party (TOP)': 2,
  },
  defaultWeight: 0.5,
  independentsWeight: 0.3,
};

/** A pattern bound to the electorates it applies to. */
type PatternAssignment = PatternPlan & { electorates: string[] };

/** Share of an electorate's count reported at each stage. */
type StagePct = { early: number; mid: number; late: number; full: number };

/**
 * A pattern plus the electorates it is applied to and how quickly each reports.
 *
 * `generalCounts` is per cycle, because the two cycles have a different number
 * of general electorates (65 in 2023, 64 in 2026). Every general electorate
 * gets exactly one pattern; the counts must therefore sum to the cycle's
 * general electorate count, which `synthetic-electorates.test.ts` enforces.
 * Only MARGINAL changes between the cycles, so the difference is visible in
 * one place rather than smeared across the list.
 */
type PatternPlan = {
  pattern: VotePattern;
  generalCounts: Record<MockElectionYear, number>;
  pct: StagePct;
};

const GENERAL_PLANS: PatternPlan[] = [
  {
    pattern: PATTERN_SAFE_NATIONAL,
    generalCounts: { '2023': 7, '2026': 7 },
    pct: { early: 0.85, mid: 0.95, late: 1.0, full: 1.0 },
  },
  {
    pattern: PATTERN_STRONG_NATIONAL,
    generalCounts: { '2023': 11, '2026': 11 },
    pct: { early: 0.75, mid: 0.85, late: 0.95, full: 1.0 },
  },
  {
    pattern: PATTERN_LEAN_NATIONAL,
    generalCounts: { '2023': 12, '2026': 12 },
    pct: { early: 0.4, mid: 0.65, late: 0.95, full: 1.0 },
  },
  {
    pattern: PATTERN_LEAN_LABOUR,
    generalCounts: { '2023': 11, '2026': 11 },
    pct: { early: 0.2, mid: 0.45, late: 0.8, full: 1.0 },
  },
  {
    pattern: PATTERN_LABOUR_STRONGHOLD,
    generalCounts: { '2023': 6, '2026': 6 },
    pct: { early: 0.15, mid: 0.4, late: 0.75, full: 1.0 },
  },
  {
    pattern: PATTERN_ACT_STRONGHOLD,
    generalCounts: { '2023': 2, '2026': 2 },
    pct: { early: 0.35, mid: 0.6, late: 0.9, full: 1.0 },
  },
  {
    pattern: PATTERN_MARGINAL,
    // Absorbs the change in general electorate count between cycles.
    generalCounts: { '2023': 7, '2026': 6 },
    pct: { early: 0.4, mid: 0.65, late: 0.9, full: 1.0 },
  },
  {
    pattern: PATTERN_VERY_CLOSE,
    generalCounts: { '2023': 4, '2026': 4 },
    pct: { early: 0.15, mid: 0.4, late: 0.85, full: 1.0 },
  },
  {
    pattern: PATTERN_PHOTO_FINISH,
    generalCounts: { '2023': 2, '2026': 2 },
    pct: { early: 0.1, mid: 0.35, late: 0.8, full: 1.0 },
  },
  {
    pattern: PATTERN_GREEN_URBAN,
    generalCounts: { '2023': 3, '2026': 3 },
    pct: { early: 0.25, mid: 0.5, late: 0.85, full: 1.0 },
  },
];

/**
 * Every Māori electorate gets the Māori pattern, so Te Pāti Māori wins all
 * seven and the resulting overhang exercises the seat-allocation maths. The
 * pattern is not drawn at random from the general pool: doing so would hand a
 * National or Labour win to a Māori electorate (and vice versa) and could hide
 * the overhang entirely.
 */
const MAORI_PCT: StagePct = {
  early: 0.15,
  mid: 0.4,
  late: 0.75,
  full: 1.0,
};

function assignPatterns(
  set: { general: string[]; maori: string[] },
  year: MockElectionYear
): PatternAssignment[] {
  const general = [...set.general];
  shuffle(general);

  let index = 0;
  const assignments: PatternAssignment[] = GENERAL_PLANS.map((plan) => {
    const count = plan.generalCounts[year];
    const electorates = general.slice(index, index + count);
    index += count;
    return { ...plan, electorates };
  });

  if (index !== general.length) {
    throw new Error(
      `Mock patterns for ${year} cover ${index} general electorates but ${general.length} exist — check generalCounts in GENERAL_PLANS`
    );
  }

  assignments.push({
    pattern: PATTERN_MAORI_ELECTORATE,
    generalCounts: { '2023': 0, '2026': 0 },
    pct: MAORI_PCT,
    electorates: [...set.maori],
  });

  return assignments;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

const TOTAL_VOTES = 30_000;

function buildSyntheticElectorate(
  electorateName: string,
  pattern: VotePattern,
  candidates: CandidateInfo[]
): SyntheticElectorate {
  const weights = candidates.map((c) => ({
    name: c.name,
    party: c.party,
    weight: c.party
      ? (pattern.weight[c.party] ?? pattern.defaultWeight)
      : pattern.independentsWeight,
  }));

  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

  const candidateResults = weights.map((w) => ({
    name: w.name,
    party: w.party,
    finalVotes: Math.round((w.weight / totalWeight) * TOTAL_VOTES),
  }));

  // Party vote calculation — use partyVoteWeight when available
  const partyVoteMap = new Map<string, number>();

  if (pattern.partyVoteWeight) {
    const partyWeightMap = new Map(Object.entries(pattern.partyVoteWeight));
    for (const c of candidates) {
      if (c.party && !partyWeightMap.has(c.party)) {
        partyWeightMap.set(
          c.party,
          pattern.weight[c.party] ?? pattern.defaultWeight
        );
      }
    }

    const partyWeights = [...partyWeightMap.entries()].map(
      ([party, weight]) => ({ party, weight })
    );

    const partyTotalWeight = partyWeights.reduce((s, pw) => s + pw.weight, 0);

    for (const pw of partyWeights) {
      partyVoteMap.set(
        pw.party,
        Math.round((pw.weight / partyTotalWeight) * TOTAL_VOTES)
      );
    }
  } else {
    for (const c of candidateResults) {
      const party = c.party ?? 'Independent';
      partyVoteMap.set(party, (partyVoteMap.get(party) ?? 0) + c.finalVotes);
    }
  }

  const sortedParties = [...partyVoteMap.entries()].sort((a, b) => b[1] - a[1]);

  return {
    name: electorateName,
    totalValidVotes: TOTAL_VOTES,
    candidates: candidateResults,
    parties: sortedParties.map(([p]) => p),
    partyVoteFinal: sortedParties.map(([, v]) => v),
  };
}

function generateStage(
  assignments: PatternAssignment[],
  candidatesByElectorate: Map<string, CandidateInfo[]>,
  stage: keyof StagePct
): ElectorateResults[] {
  const results: ElectorateResults[] = [];
  for (const { pattern, electorates, pct } of assignments) {
    for (const name of electorates) {
      const candidates = candidatesByElectorate.get(name) ?? [];
      const synthetic = buildSyntheticElectorate(name, pattern, candidates);
      results.push(generatePartialResults(synthetic, pct[stage]));
    }
  }
  return results;
}

export type MockElectionSet = {
  year: MockElectionYear;
  electorates: MockElectorate[];
  /** One result set per counting stage, each covering every electorate. */
  stages: Record<keyof StagePct, ElectorateResults[]>;
};

/**
 * Build the whole mock feed for one election cycle: electorates, candidates,
 * and the four counting stages.
 */
export function buildMockElectionSet(
  year: MockElectionYear = DEFAULT_MOCK_ELECTION_YEAR
): MockElectionSet {
  const set = MOCK_ELECTORATE_SETS[year];
  const electorates = buildElectorates(set);
  const candidatesByElectorate = new Map(
    electorates.map((e) => [e.name, e.candidates])
  );
  const assignments = assignPatterns(set, year);

  return {
    year,
    electorates,
    stages: {
      early: generateStage(assignments, candidatesByElectorate, 'early'),
      mid: generateStage(assignments, candidatesByElectorate, 'mid'),
      late: generateStage(assignments, candidatesByElectorate, 'late'),
      full: generateStage(assignments, candidatesByElectorate, 'full'),
    },
  };
}
