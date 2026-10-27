import { ElectorateResults } from '@election-night/core/types';

export type SyntheticCandidate = {
  name: string;
  party?: string;
  finalVotes: number;
};

export type SyntheticElectorate = {
  name: string;
  candidates: SyntheticCandidate[];
  parties: string[];
  partyVoteFinal: number[];
  totalValidVotes: number;
};

function adjustRounding(votes: number[], targetTotal: number): number[] {
  const sum = votes.reduce((a, b) => a + b, 0);
  const diff = targetTotal - sum;
  if (diff === 0) return votes;
  const maxIndex = votes.indexOf(Math.max(...votes));
  const adjusted = [...votes];
  adjusted[maxIndex] += diff;
  return adjusted;
}

export function generatePartialResults(
  electorate: SyntheticElectorate,
  percentCounted: number
): ElectorateResults {
  const votesCounted = Math.round(electorate.totalValidVotes * percentCounted);

  const rawCandidateVotes = electorate.candidates.map((c) =>
    Math.round(c.finalVotes * percentCounted)
  );
  const rawPartyVotes = electorate.partyVoteFinal.map((v) =>
    Math.round(v * percentCounted)
  );

  const adjCandidateVotes = adjustRounding(rawCandidateVotes, votesCounted);
  const adjPartyVotes = adjustRounding(rawPartyVotes, votesCounted);

  return {
    electorateName: electorate.name,
    candidateVotes: electorate.candidates.map((c, i) => ({
      candidate: c.name,
      votes: adjCandidateVotes[i],
      party: c.party,
    })),
    partyVotes: electorate.parties.map((p, i) => ({
      candidate: p,
      votes: adjPartyVotes[i],
    })),
    votesCounted,
    votePercentageCounted: percentCounted,
  };
}

export const SCENARIO_LANDSLIDE: SyntheticElectorate = {
  name: 'Northern Heartland',
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Smith, John', party: 'National Party', finalVotes: 16_500 },
    { name: 'Jones, Mary', party: 'Labour Party', finalVotes: 5_500 },
    { name: 'Green, Emma', party: 'Green Party', finalVotes: 2_500 },
    { name: 'Brown, Bob', party: 'ACT New Zealand', finalVotes: 2_000 },
    { name: 'White, Sam', party: 'New Zealand First Party', finalVotes: 1_500 },
    { name: 'King, Lisa', finalVotes: 700 },
    { name: 'Te Rangi, Hana', party: 'Te Pāti Māori', finalVotes: 500 },
    { name: 'Black, Tom', finalVotes: 500 },
    { name: 'Gray, Amy', finalVotes: 300 },
  ],
  parties: [
    'National Party',
    'Labour Party',
    'Green Party',
    'ACT New Zealand',
    'New Zealand First Party',
    'Te Pāti Māori',
    'Opportunity Party',
    'New Conservative',
    'Advance NZ',
  ],
  partyVoteFinal: [15_500, 6_000, 3_000, 2_000, 1_500, 700, 500, 300, 500],
};

export const SCENARIO_STRONG: SyntheticElectorate = {
  name: 'Central City',
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Williams, Sarah', party: 'Labour Party', finalVotes: 12_000 },
    { name: 'Thompson, James', party: 'National Party', finalVotes: 6_000 },
    { name: 'Taylor, David', party: 'Green Party', finalVotes: 5_000 },
    { name: 'Clark, Robert', party: 'ACT New Zealand', finalVotes: 2_000 },
    {
      name: 'Baker, Helen',
      party: 'New Zealand First Party',
      finalVotes: 1_800,
    },
    { name: 'Noble, Rachel', party: 'Te Pāti Māori', finalVotes: 1_200 },
    { name: 'Adams, Peter', finalVotes: 1_000 },
    { name: 'Knight, Steven', finalVotes: 600 },
    {
      name: 'Lee, Emma',
      party: 'Opportunity Party',
      finalVotes: 400,
    },
  ],
  parties: [
    'Labour Party',
    'National Party',
    'Green Party',
    'ACT New Zealand',
    'New Zealand First Party',
    'Te Pāti Māori',
    'Opportunity Party',
    'New Conservative',
    'Advance NZ',
  ],
  partyVoteFinal: [11_500, 6_000, 5_200, 2_000, 1_800, 1_200, 800, 700, 800],
};

export const SCENARIO_MARGINAL: SyntheticElectorate = {
  name: 'Harbour Fringe',
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Davis, Mark', party: 'National Party', finalVotes: 12_625 },
    { name: 'Wilson, Anna', party: 'Labour Party', finalVotes: 12_325 },
    { name: 'Moore, Peter', party: 'Green Party', finalVotes: 2_200 },
    { name: 'Lee, Susan', party: 'ACT New Zealand', finalVotes: 1_400 },
    { name: 'Baker, Tom', party: 'New Zealand First Party', finalVotes: 800 },
    { name: 'Scott, Jane', party: 'Te Pāti Māori', finalVotes: 350 },
    { name: 'Hill, David', finalVotes: 200 },
    { name: 'Young, Claire', finalVotes: 100 },
  ],
  parties: [
    'National Party',
    'Labour Party',
    'Green Party',
    'ACT New Zealand',
    'New Zealand First Party',
    'Te Pāti Māori',
    'Opportunity Party',
    'New Conservative',
    'Advance NZ',
  ],
  partyVoteFinal: [11_800, 11_500, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

export const SCENARIO_CLOSE: SyntheticElectorate = {
  name: 'Plains District',
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Anderson, Tom', party: 'National Party', finalVotes: 12_515 },
    { name: 'Martin, Kate', party: 'Labour Party', finalVotes: 12_485 },
    { name: 'White, James', party: 'Green Party', finalVotes: 2_200 },
    { name: 'Harris, Lucy', party: 'ACT New Zealand', finalVotes: 1_400 },
    { name: 'Turner, Ben', party: 'New Zealand First Party', finalVotes: 800 },
    { name: 'Phillips, Ella', party: 'Te Pāti Māori', finalVotes: 350 },
    { name: 'Carter, Jack', finalVotes: 150 },
    { name: 'Reed, Molly', finalVotes: 100 },
  ],
  parties: [
    'National Party',
    'Labour Party',
    'Green Party',
    'ACT New Zealand',
    'New Zealand First Party',
    'Te Pāti Māori',
    'Opportunity Party',
    'New Conservative',
    'Advance NZ',
  ],
  partyVoteFinal: [11_800, 11_500, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

export const SCENARIO_EXTREMELY_CLOSE: SyntheticElectorate = {
  name: 'Borderline',
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Robinson, Paul', party: 'Labour Party', finalVotes: 12_502 },
    { name: 'Campbell, Fiona', party: 'National Party', finalVotes: 12_498 },
    { name: 'Stewart, Ian', party: 'Green Party', finalVotes: 2_200 },
    { name: 'Mitchell, Jo', party: 'ACT New Zealand', finalVotes: 1_400 },
    { name: 'Ross, Liam', party: 'New Zealand First Party', finalVotes: 800 },
    { name: 'Woods, Sophie', party: 'Te Pāti Māori', finalVotes: 350 },
    { name: 'Grant, Oliver', finalVotes: 150 },
    { name: 'Fox, Lily', finalVotes: 100 },
  ],
  parties: [
    'Labour Party',
    'National Party',
    'Green Party',
    'ACT New Zealand',
    'New Zealand First Party',
    'Te Pāti Māori',
    'Opportunity Party',
    'New Conservative',
    'Advance NZ',
  ],
  partyVoteFinal: [11_500, 11_800, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

export const SCENARIO_TIED: SyntheticElectorate = {
  name: 'Deadlock',
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Turner, Richard', party: 'National Party', finalVotes: 12_500 },
    { name: 'Collins, Patricia', party: 'Labour Party', finalVotes: 12_500 },
    { name: 'Ward, Michael', party: 'Green Party', finalVotes: 2_200 },
    { name: 'Barnes, Angela', party: 'ACT New Zealand', finalVotes: 1_400 },
    {
      name: 'Murphy, Daniel',
      party: 'New Zealand First Party',
      finalVotes: 800,
    },
    { name: 'Bennett, Hannah', party: 'Te Pāti Māori', finalVotes: 350 },
    { name: 'Crawford, Samuel', finalVotes: 150 },
    { name: 'Fisher, Amelia', finalVotes: 100 },
  ],
  parties: [
    'National Party',
    'Labour Party',
    'Green Party',
    'ACT New Zealand',
    'New Zealand First Party',
    'Te Pāti Māori',
    'Opportunity Party',
    'New Conservative',
    'Advance NZ',
  ],
  partyVoteFinal: [11_800, 11_500, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

const PCT_POINTS = [0.1, 0.3, 0.5, 0.8, 1.0] as const;
type PctPoint = (typeof PCT_POINTS)[number];

function generateFixtures(
  electorate: SyntheticElectorate
): Record<PctPoint, ElectorateResults> {
  const entries = PCT_POINTS.map(
    (p) => [p, generatePartialResults(electorate, p)] as const
  );
  return Object.fromEntries(entries) as Record<PctPoint, ElectorateResults>;
}

export const landslideFixtures = generateFixtures(SCENARIO_LANDSLIDE);
export const strongFixtures = generateFixtures(SCENARIO_STRONG);
export const marginalFixtures = generateFixtures(SCENARIO_MARGINAL);
export const closeFixtures = generateFixtures(SCENARIO_CLOSE);
export const extremelyCloseFixtures = generateFixtures(
  SCENARIO_EXTREMELY_CLOSE
);
export const tiedFixtures = generateFixtures(SCENARIO_TIED);

export type ElectorateAtPct = {
  scenario: SyntheticElectorate;
  percentCounted: number;
};

export function makeAggregateResults(
  specs: ElectorateAtPct[]
): ElectorateResults[] {
  return specs.map(({ scenario, percentCounted }) =>
    generatePartialResults(scenario, percentCounted)
  );
}

export function makeEarlyCount(): ElectorateResults[] {
  return makeAggregateResults([
    { scenario: SCENARIO_LANDSLIDE, percentCounted: 0.8 },
    { scenario: SCENARIO_STRONG, percentCounted: 0.1 },
    { scenario: SCENARIO_MARGINAL, percentCounted: 0.3 },
    { scenario: SCENARIO_CLOSE, percentCounted: 0.3 },
    { scenario: SCENARIO_EXTREMELY_CLOSE, percentCounted: 0.1 },
    { scenario: SCENARIO_TIED, percentCounted: 0.1 },
  ]);
}

export function makeMidCount(): ElectorateResults[] {
  return makeAggregateResults([
    { scenario: SCENARIO_LANDSLIDE, percentCounted: 0.95 },
    { scenario: SCENARIO_STRONG, percentCounted: 0.4 },
    { scenario: SCENARIO_MARGINAL, percentCounted: 0.6 },
    { scenario: SCENARIO_CLOSE, percentCounted: 0.6 },
    { scenario: SCENARIO_EXTREMELY_CLOSE, percentCounted: 0.4 },
    { scenario: SCENARIO_TIED, percentCounted: 0.4 },
  ]);
}

export function makeLateCount(): ElectorateResults[] {
  return makeAggregateResults([
    { scenario: SCENARIO_LANDSLIDE, percentCounted: 1.0 },
    { scenario: SCENARIO_STRONG, percentCounted: 0.8 },
    { scenario: SCENARIO_MARGINAL, percentCounted: 0.95 },
    { scenario: SCENARIO_CLOSE, percentCounted: 0.95 },
    { scenario: SCENARIO_EXTREMELY_CLOSE, percentCounted: 0.8 },
    { scenario: SCENARIO_TIED, percentCounted: 0.8 },
  ]);
}

export const earlyCountResults = makeEarlyCount();
export const midCountResults = makeMidCount();
export const lateCountResults = makeLateCount();
