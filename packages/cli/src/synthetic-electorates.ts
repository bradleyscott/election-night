import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import {
  generatePartialResults,
  type SyntheticElectorate,
} from './synthetic-data.js';
import type { ElectorateResults } from '@election-night/core/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CSV_CANDIDATES = readFileSync(
  resolve(__dirname, '../../../csv/candidates.csv'),
  'utf-8'
);
const candidateRecords = parse(CSV_CANDIDATES, { columns: true }) as Record<
  string,
  string
>[];

type CandidateInfo = { name: string; party?: string };

const electorateCandidates = new Map<string, CandidateInfo[]>();
for (const rec of candidateRecords) {
  const name = rec.Name;
  const electorate = rec.Electorate;
  const party = rec.Party === 'Independent' ? undefined : rec.Party;
  const list = electorateCandidates.get(electorate) ?? [];
  list.push({ name, party });
  electorateCandidates.set(electorate, list);
}

function getElectorateNames(): string[] {
  const csv = readFileSync(
    resolve(__dirname, '../../../csv/electorates.csv'),
    'utf-8'
  );
  return csv
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
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

type PatternEntry = {
  pattern: VotePattern;
  electorates: string[];
};

const ALL_PATTERNS: Omit<PatternEntry, 'electorates'>[] = [
  { pattern: PATTERN_SAFE_NATIONAL },
  { pattern: PATTERN_STRONG_NATIONAL },
  { pattern: PATTERN_LEAN_NATIONAL },
  { pattern: PATTERN_LEAN_LABOUR },
  { pattern: PATTERN_LABOUR_STRONGHOLD },
  { pattern: PATTERN_ACT_STRONGHOLD },
  { pattern: PATTERN_MAORI_ELECTORATE },
  { pattern: PATTERN_MARGINAL },
  { pattern: PATTERN_VERY_CLOSE },
  { pattern: PATTERN_PHOTO_FINISH },
  { pattern: PATTERN_GREEN_URBAN },
];

const TARGET_COUNTS = [7, 11, 12, 11, 6, 2, 6, 8, 4, 2, 3];

function assignElectorates(names: string[]): PatternEntry[] {
  const shuffled = [...names];
  shuffle(shuffled);
  let idx = 0;
  return ALL_PATTERNS.map((entry, i) => {
    const count = TARGET_COUNTS[i];
    const electorates = shuffled.slice(idx, idx + count);
    idx += count;
    return { pattern: entry.pattern, electorates };
  });
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

    const partyTotalWeight = partyWeights.reduce(
      (s, pw) => s + pw.weight,
      0
    );

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

  const sortedParties = [...partyVoteMap.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  return {
    name: electorateName,
    totalValidVotes: TOTAL_VOTES,
    candidates: candidateResults,
    parties: sortedParties.map(([p]) => p),
    partyVoteFinal: sortedParties.map(([, v]) => v),
  };
}

function generateAtPct(
  assignments: PatternEntry[],
  getPct: (entry: PatternEntry, index: number) => number
): ElectorateResults[] {
  const results: ElectorateResults[] = [];
  for (let i = 0; i < assignments.length; i++) {
    const { pattern, electorates } = assignments[i];
    const pct = getPct(assignments[i], i);
    for (const name of electorates) {
      const candidates = electorateCandidates.get(name) ?? [];
      const syn = buildSyntheticElectorate(name, pattern, candidates);
      results.push(generatePartialResults(syn, pct));
    }
  }
  return results;
}

const earlyPct = () => [0.85, 0.75, 0.40, 0.20, 0.15, 0.35, 0.15, 0.40, 0.15, 0.10, 0.25];

const midPct = () => [0.95, 0.85, 0.65, 0.45, 0.40, 0.60, 0.40, 0.65, 0.40, 0.35, 0.50];

const latePct = () => [1.0, 0.95, 0.95, 0.80, 0.75, 0.90, 0.75, 0.90, 0.85, 0.80, 0.85];

const fullPct = () => [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

const electorates = getElectorateNames();
const assignments = assignElectorates(electorates);

export const earlyCountResults = generateAtPct(assignments, (_, i) =>
  earlyPct()[i]
);
export const midCountResults = generateAtPct(assignments, (_, i) =>
  midPct()[i]
);
export const lateCountResults = generateAtPct(assignments, (_, i) =>
  latePct()[i]
);
export const fullCountResults = generateAtPct(assignments, (_, i) =>
  fullPct()[i]
);
