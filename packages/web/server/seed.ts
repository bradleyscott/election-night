import type {
  ResultsPayload,
  ElectorateResults,
  VotingResults,
  WithParty,
  PartyList,
  WithLeaders,
  WithMarginOfError,
  WithSeats,
  WithAdjustedRank,
} from '@election-night/core/types';

type SyntheticCandidate = {
  name: string;
  party?: string;
  finalVotes: number;
};

type SyntheticElectorate = {
  name: string;
  candidates: SyntheticCandidate[];
  parties: string[];
  partyVoteFinal: number[];
  totalValidVotes: number;
};

const GENERAL_ELECTORATES = [
  'Auckland Central', 'Banks Peninsula', 'Bay of Plenty', 'Botany',
  'Christchurch Central', 'Christchurch East', 'Coromandel', 'Dunedin',
  'East Coast', 'East Coast Bays', 'Epsom', 'Hamilton East', 'Hamilton West',
  'Hutt South', 'Ilam', 'Invercargill', 'Kaikōura', 'Kaipara ki Mahurangi',
  'Kelston', 'Mana', 'Māngere', 'Manurewa', 'Maungakiekie', 'Mt Albert',
  'Mt Roskill', 'Napier', 'Nelson', 'New Lynn', 'New Plymouth', 'North Shore',
  'Northcote', 'Northland', 'Ōhāriu', 'Ōtaki', 'Pakuranga',
  'Palmerston North', 'Panmure-Ōtāhuhu', 'Papakura', 'Port Waikato',
  'Rangitata', 'Rangitīkei', 'Remutaka', 'Rongotai', 'Rotorua', 'Selwyn',
  'Southland', 'Taieri', 'Takanini', 'Tāmaki', 'Taranaki-King Country',
  'Taupō', 'Tauranga', 'Te Atatū', 'Tukituki', 'Upper Harbour', 'Waikato',
  'Waimakariri', 'Wairarapa', 'Waitaki', 'Wellington Central',
  'West Coast-Tasman', 'Whanganui', 'Whangaparāoa', 'Whangārei', 'Wigram',
];

const MAORI_ELECTORATES = [
  'Hauraki-Waikato', 'Ikaroa-Rāwhiti', 'Tāmaki Makaurau',
  'Te Tai Hauāuru', 'Te Tai Tokerau', 'Te Tai Tonga', 'Waiariki',
];

function adjustRounding(votes: number[], targetTotal: number): number[] {
  const sum = votes.reduce((a, b) => a + b, 0);
  const diff = targetTotal - sum;
  if (diff === 0) return votes;
  const maxIndex = votes.indexOf(Math.max(...votes));
  const adjusted = [...votes];
  adjusted[maxIndex] += diff;
  return adjusted;
}

function generatePartialResults(
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

const SCENARIO_LANDSLIDE = {
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
    'National Party', 'Labour Party', 'Green Party', 'ACT New Zealand',
    'New Zealand First Party', 'Te Pāti Māori', 'The Opportunities Party (TOP)',
    'New Conservative', 'Advance NZ',
  ],
  partyVoteFinal: [15_500, 6_000, 3_000, 2_000, 1_500, 700, 500, 300, 500],
};

const SCENARIO_STRONG = {
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Williams, Sarah', party: 'Labour Party', finalVotes: 12_000 },
    { name: 'Thompson, James', party: 'National Party', finalVotes: 6_000 },
    { name: 'Taylor, David', party: 'Green Party', finalVotes: 5_000 },
    { name: 'Clark, Robert', party: 'ACT New Zealand', finalVotes: 2_000 },
    { name: 'Baker, Helen', party: 'New Zealand First Party', finalVotes: 1_800 },
    { name: 'Noble, Rachel', party: 'Te Pāti Māori', finalVotes: 1_200 },
    { name: 'Adams, Peter', finalVotes: 1_000 },
    { name: 'Knight, Steven', finalVotes: 600 },
    { name: 'Lee, Emma', party: 'The Opportunities Party (TOP)', finalVotes: 400 },
  ],
  parties: [
    'Labour Party', 'National Party', 'Green Party', 'ACT New Zealand',
    'New Zealand First Party', 'Te Pāti Māori', 'The Opportunities Party (TOP)',
    'New Conservative', 'Advance NZ',
  ],
  partyVoteFinal: [11_500, 6_000, 5_200, 2_000, 1_800, 1_200, 800, 700, 800],
};

const SCENARIO_MARGINAL = {
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
    'National Party', 'Labour Party', 'Green Party', 'ACT New Zealand',
    'New Zealand First Party', 'Te Pāti Māori', 'The Opportunities Party (TOP)',
    'New Conservative', 'Advance NZ',
  ],
  partyVoteFinal: [11_800, 11_500, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

const SCENARIO_CLOSE = {
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
    'National Party', 'Labour Party', 'Green Party', 'ACT New Zealand',
    'New Zealand First Party', 'Te Pāti Māori', 'The Opportunities Party (TOP)',
    'New Conservative', 'Advance NZ',
  ],
  partyVoteFinal: [11_800, 11_500, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

const SCENARIO_EXTREMELY_CLOSE = {
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
    'Labour Party', 'National Party', 'Green Party', 'ACT New Zealand',
    'New Zealand First Party', 'Te Pāti Māori', 'The Opportunities Party (TOP)',
    'New Conservative', 'Advance NZ',
  ],
  partyVoteFinal: [11_500, 11_800, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

const SCENARIO_TIED = {
  totalValidVotes: 30_000,
  candidates: [
    { name: 'Turner, Richard', party: 'National Party', finalVotes: 12_500 },
    { name: 'Collins, Patricia', party: 'Labour Party', finalVotes: 12_500 },
    { name: 'Ward, Michael', party: 'Green Party', finalVotes: 2_200 },
    { name: 'Barnes, Angela', party: 'ACT New Zealand', finalVotes: 1_400 },
    { name: 'Murphy, Daniel', party: 'New Zealand First Party', finalVotes: 800 },
    { name: 'Bennett, Hannah', party: 'Te Pāti Māori', finalVotes: 350 },
    { name: 'Crawford, Samuel', finalVotes: 150 },
    { name: 'Fisher, Amelia', finalVotes: 100 },
  ],
  parties: [
    'National Party', 'Labour Party', 'Green Party', 'ACT New Zealand',
    'New Zealand First Party', 'Te Pāti Māori', 'The Opportunities Party (TOP)',
    'New Conservative', 'Advance NZ',
  ],
  partyVoteFinal: [11_800, 11_500, 2_600, 1_800, 1_000, 500, 400, 200, 200],
};

const ALL_SCENARIOS = [
  SCENARIO_LANDSLIDE,
  SCENARIO_STRONG,
  SCENARIO_MARGINAL,
  SCENARIO_CLOSE,
  SCENARIO_EXTREMELY_CLOSE,
  SCENARIO_TIED,
];

function calculateLeadElectorate(
  results: ElectorateResults
): ElectorateResults & WithLeaders {
  const sortedCandidates = [...results.candidateVotes].sort(
    (a, b) => b.votes - a.votes
  );
  const leadingCandidate = sortedCandidates[0].candidate;
  const leadingCandidateParty = 'party' in sortedCandidates[0]
    ? (sortedCandidates[0] as VotingResults & WithParty).party
    : undefined;
  const secondCandidate = sortedCandidates[1].candidate;
  const secondCandidateParty = 'party' in sortedCandidates[1]
    ? (sortedCandidates[1] as VotingResults & WithParty).party
    : undefined;
  const margin = sortedCandidates[0].votes - sortedCandidates[1].votes;
  const marginPercent = margin / results.votesCounted;

  return {
    ...results,
    leaders: {
      leadingCandidate,
      leadingCandidateParty,
      secondCandidate,
      secondCandidateParty,
      margin,
      marginPercent,
      isPredictedWinner: false,
    },
  };
}

function predictElectorateWinner(
  results: ElectorateResults & WithLeaders,
  confidence: number
): ElectorateResults & WithLeaders & WithMarginOfError {
  const votesCounted = results.votesCounted;
  const totalVotes = votesCounted / results.votePercentageCounted;
  const candidateVotes = [...results.candidateVotes].sort(
    (a, b) => b.votes - a.votes
  );
  const leadingShare = candidateVotes[0].votes / votesCounted;
  const secondShare = candidateVotes[1].votes / votesCounted;
  const leadPercent = leadingShare - secondShare;

  const zScore = 1.96;
  const finitePopulationCorrection = Math.sqrt(
    (totalVotes - votesCounted) / (totalVotes - 1)
  );
  const diffVariance =
    (leadingShare + secondShare - leadPercent * leadPercent) / votesCounted;

  const marginOfError =
    zScore * Math.sqrt(diffVariance) * finitePopulationCorrection;

  return {
    ...results,
    marginOfError,
    leaders: {
      ...results.leaders,
      isPredictedWinner: leadPercent > marginOfError,
    },
  };
}

function calculatePartyVote(
  results: (ElectorateResults & WithLeaders & WithMarginOfError)[]
): VotingResults[] {
  const partyVoteMap = new Map<string, number>();
  const allPartyVotes = results.flatMap((x) => x.partyVotes);
  allPartyVotes.forEach((x) => {
    partyVoteMap.set(x.candidate, (partyVoteMap.get(x.candidate) ?? 0) + x.votes);
  });
  return Array.from(partyVoteMap.entries()).map(([candidate, votes]) => ({
    candidate,
    votes,
  }));
}

function calculateElectorateWinSeats(
  electorateVotes: (ElectorateResults & WithLeaders)[]
): Record<string, number> {
  return electorateVotes.reduce(
    (acc, r) => {
      const party = r.leaders.leadingCandidateParty;
      if (!party) return acc;
      acc[party] = (acc[party] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

function sainteLagueSimple(
  votes: Record<string, number>,
  totalSeats: number
): Record<string, number> {
  const parties = Object.keys(votes);
  const seats: Record<string, number> = {};
  const divisors: Record<string, number> = {};

  for (const p of parties) {
    seats[p] = 0;
    divisors[p] = votes[p] / 1;
  }

  for (let s = 0; s < totalSeats; s++) {
    let maxParty = parties[0];
    let maxDiv = divisors[parties[0]];
    for (const p of parties) {
      if (divisors[p] > maxDiv) {
        maxDiv = divisors[p];
        maxParty = p;
      }
    }
    seats[maxParty] += 1;
    divisors[maxParty] = votes[maxParty] / (2 * seats[maxParty] + 1);
  }

  return seats;
}

function calculatePartyVoteWithSeats(
  partyVotes: VotingResults[],
  electorateVotes: (ElectorateResults & WithLeaders)[]
): (VotingResults & WithSeats)[] {
  const electorateSeats = calculateElectorateWinSeats(electorateVotes);
  const totalVotes = partyVotes.reduce((s, x) => s + x.votes, 0);

  const votesMap: Record<string, number> = {};
  for (const pv of partyVotes) {
    votesMap[pv.candidate] = pv.votes;
  }

  const partiesWithElectorateWins = Array.from(
    new Set(electorateVotes.map((x) => x.leaders.leadingCandidateParty))
  );

  const eligible = partyVotes.filter(
    (x) => x.votes / totalVotes >= 0.05 || partiesWithElectorateWins.includes(x.candidate)
  );

  const eligibleVotes: Record<string, number> = {};
  for (const e of eligible) {
    eligibleVotes[e.candidate] = e.votes;
  }

  const seats = sainteLagueSimple(eligibleVotes, 120);

  return partyVotes.map((x) => ({
    ...x,
    seats: seats[x.candidate] || 0,
    electorateSeats: electorateSeats[x.candidate] || 0,
    listSeats: (seats[x.candidate] || 0) - (electorateSeats[x.candidate] || 0),
  }));
}

const PARTY_LISTS: PartyList[] = [
  { party: 'National Party', candidate: 'Smith, John', listRank: 1 },
  { party: 'National Party', candidate: 'Thompson, James', listRank: 2 },
  { party: 'National Party', candidate: 'Davis, Mark', listRank: 3 },
  { party: 'National Party', candidate: 'Anderson, Tom', listRank: 4 },
  { party: 'National Party', candidate: 'Turner, Richard', listRank: 5 },
  { party: 'National Party', candidate: 'Williams, Peter', listRank: 6 },
  { party: 'National Party', candidate: 'Cooper, Sarah', listRank: 7 },
  { party: 'National Party', candidate: 'Mitchell, David', listRank: 8 },
  { party: 'Labour Party', candidate: 'Williams, Sarah', listRank: 1 },
  { party: 'Labour Party', candidate: 'Jones, Mary', listRank: 2 },
  { party: 'Labour Party', candidate: 'Wilson, Anna', listRank: 3 },
  { party: 'Labour Party', candidate: 'Martin, Kate', listRank: 4 },
  { party: 'Labour Party', candidate: 'Robinson, Paul', listRank: 5 },
  { party: 'Labour Party', candidate: 'Collins, Patricia', listRank: 6 },
  { party: 'Labour Party', candidate: 'Clark, Helen', listRank: 7 },
  { party: 'Labour Party', candidate: 'Parker, David', listRank: 8 },
  { party: 'Green Party', candidate: 'Taylor, David', listRank: 1 },
  { party: 'Green Party', candidate: 'Green, Emma', listRank: 2 },
  { party: 'Green Party', candidate: 'Moore, Peter', listRank: 3 },
  { party: 'Green Party', candidate: 'White, James', listRank: 4 },
  { party: 'Green Party', candidate: 'Stewart, Ian', listRank: 5 },
  { party: 'Green Party', candidate: 'Swarbrick, Chloe', listRank: 6 },
  { party: 'Green Party', candidate: 'Shaw, James', listRank: 7 },
  { party: 'Green Party', candidate: 'Davidson, Marama', listRank: 8 },
  { party: 'ACT New Zealand', candidate: 'Brown, Bob', listRank: 1 },
  { party: 'ACT New Zealand', candidate: 'Clark, Robert', listRank: 2 },
  { party: 'ACT New Zealand', candidate: 'Lee, Susan', listRank: 3 },
  { party: 'ACT New Zealand', candidate: 'Harris, Lucy', listRank: 4 },
  { party: 'ACT New Zealand', candidate: 'Mitchell, Jo', listRank: 5 },
  { party: 'ACT New Zealand', candidate: 'Barnes, Angela', listRank: 6 },
  { party: 'ACT New Zealand', candidate: 'Seymour, David', listRank: 7 },
  { party: 'ACT New Zealand', candidate: 'van Velden, Brooke', listRank: 8 },
  { party: 'New Zealand First Party', candidate: 'White, Sam', listRank: 1 },
  { party: 'New Zealand First Party', candidate: 'Baker, Helen', listRank: 2 },
  { party: 'New Zealand First Party', candidate: 'Baker, Tom', listRank: 3 },
  { party: 'New Zealand First Party', candidate: 'Turner, Ben', listRank: 4 },
  { party: 'New Zealand First Party', candidate: 'Ross, Liam', listRank: 5 },
  { party: 'New Zealand First Party', candidate: 'Murphy, Daniel', listRank: 6 },
  { party: 'New Zealand First Party', candidate: 'Peters, Winston', listRank: 7 },
  { party: 'New Zealand First Party', candidate: 'Peters, Shane', listRank: 8 },
  { party: 'Te Pāti Māori', candidate: 'Te Rangi, Hana', listRank: 1 },
  { party: 'Te Pāti Māori', candidate: 'Noble, Rachel', listRank: 2 },
  { party: 'Te Pāti Māori', candidate: 'Scott, Jane', listRank: 3 },
  { party: 'Te Pāti Māori', candidate: 'Phillips, Ella', listRank: 4 },
  { party: 'Te Pāti Māori', candidate: 'Woods, Sophie', listRank: 5 },
  { party: 'Te Pāti Māori', candidate: 'Bennett, Hannah', listRank: 6 },
  { party: 'Te Pāti Māori', candidate: 'Waititi, Rawiri', listRank: 7 },
  { party: 'Te Pāti Māori', candidate: 'Ngarewa-Packer, Debbie', listRank: 8 },
  { party: 'The Opportunities Party (TOP)', candidate: 'Lee, Emma', listRank: 1 },
  { party: 'The Opportunities Party (TOP)', candidate: 'Rue, Jack', listRank: 2 },
  { party: 'The Opportunities Party (TOP)', candidate: 'Curtis, Jess', listRank: 3 },
  { party: 'New Conservative', candidate: 'Simmons, Craig', listRank: 1 },
  { party: 'New Conservative', candidate: 'Jones, Esther', listRank: 2 },
  { party: 'Advance NZ', candidate: 'Wilson, Mark', listRank: 1 },
  { party: 'Advance NZ', candidate: 'Baker, Julia', listRank: 2 },
];

function calculatePartyListSeed(
  electoralVotes: (ElectorateResults & WithLeaders)[],
  seats: (VotingResults & WithSeats)[],
  list: PartyList[]
): (PartyList & WithAdjustedRank)[] {
  const winners: Record<string, string[]> = {};
  for (const v of electoralVotes) {
    const party = v.leaders.leadingCandidateParty;
    if (!party) continue;
    if (!winners[party]) winners[party] = [];
    winners[party].push(v.leaders.leadingCandidate);
  }

  const withAdjustedRank = list.map((x) => {
    const higherRankedWinners = list.filter(
      (l) =>
        l.listRank < x.listRank &&
        l.party === x.party &&
        winners[l.party]?.includes(l.candidate)
    );
    return {
      ...x,
      adjustedRank: x.listRank - higherRankedWinners.length,
    };
  });

  return withAdjustedRank.map((x) => ({
    ...x,
    distanceFromCut:
      (seats.find((y) => y.candidate === x.party)?.listSeats || 0) -
      x.adjustedRank,
  }));
}

export function generateSeedData(): ResultsPayload {
  const perc = 0.5;
  const allNames = [...GENERAL_ELECTORATES, ...MAORI_ELECTORATES];

  const electorateResults = allNames.map((name, i) => {
    const scenario = ALL_SCENARIOS[i % ALL_SCENARIOS.length];
    const electorate: SyntheticElectorate = {
      name,
      ...scenario,
    };
    return generatePartialResults(electorate, perc);
  });

  const withLeaders = electorateResults.map((e) => calculateLeadElectorate(e));

  const withPredictions = withLeaders.map((e) =>
    predictElectorateWinner(e, 0.95)
  );

  const pv = calculatePartyVote(withPredictions);
  const partyVote = calculatePartyVoteWithSeats(pv, withPredictions);

  const partyLists = calculatePartyListSeed(
    withPredictions,
    partyVote,
    PARTY_LISTS
  );

  return {
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  };
}
