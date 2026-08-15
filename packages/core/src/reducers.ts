import sainteLague from 'sainte-lague';
import jstat from 'jstat';
import {
  ElectorateResults,
  PartyList,
  PredictionStatus,
  VotingResults,
  WithLeaders,
  WithMarginOfError,
  WithPercentages,
  WithSeats,
  WithAdjustedRank,
} from './types.js';

function calculateMarginOfError(
  resultAsPercentage: number,
  sample: number,
  population: number,
  confidence: number
) {
  const zScore = jstat.normal.inv(1 - (1 - confidence) / 2, 0, 1);
  const finitePopulationCorrection = Math.sqrt(
    (population - sample) / (population - 1)
  );
  const marginOfError =
    zScore *
    Math.sqrt((resultAsPercentage * (1 - resultAsPercentage)) / sample) *
    finitePopulationCorrection;

  return marginOfError;
}

function predictionStatusFromRatio(ratio: number): PredictionStatus {
  if (ratio > 2) return 'projected';
  if (ratio > 1.5) return 'likely';
  if (ratio > 1) return 'leaning';
  return 'too-close';
}

function calculateLead(
  results: ElectorateResults,
  partyMap: Record<string, string | undefined>
): ElectorateResults & WithLeaders {
  const sortedCandidates = [...results.candidateVotes].sort(
    (a, b) => b.votes - a.votes
  );

  const leadingCandidate = sortedCandidates[0]?.candidate ?? '';
  const leadingCandidateParty = leadingCandidate
    ? partyMap[leadingCandidate]
    : undefined;
  const secondCandidate = sortedCandidates[1]?.candidate ?? '';
  const secondCandidateParty = secondCandidate
    ? partyMap[secondCandidate]
    : undefined;
  const margin =
    (sortedCandidates[0]?.votes ?? 0) - (sortedCandidates[1]?.votes ?? 0);
  const marginPercent = results.votesCounted
    ? margin / results.votesCounted
    : 0;

  return {
    ...results,
    candidateVotes: sortedCandidates,
    leaders: {
      leadingCandidate,
      leadingCandidateParty,
      secondCandidate,
      secondCandidateParty,
      margin,
      marginPercent,
      predictionStatus: 'too-close',
    },
  };
}

function predictWinner(
  results: ElectorateResults & WithLeaders,
  confidence: number
): ElectorateResults & WithLeaders & WithMarginOfError {
  const votesCounted = results.votesCounted;
  const totalVotes = votesCounted / results.votePercentageCounted;
  const leadingShare = (results.candidateVotes[0]?.votes ?? 0) / votesCounted;
  const secondShare = (results.candidateVotes[1]?.votes ?? 0) / votesCounted;
  const leadPercent = leadingShare - secondShare;

  const zScore = jstat.normal.inv(1 - (1 - confidence) / 2, 0, 1);
  const finitePopulationCorrection = Math.sqrt(
    (totalVotes - votesCounted) / (totalVotes - 1)
  );
  const diffVariance =
    (leadingShare + secondShare - leadPercent * leadPercent) / votesCounted;

  const marginOfError =
    zScore * Math.sqrt(diffVariance) * finitePopulationCorrection;

  const ratio =
    marginOfError > 0
      ? leadPercent / marginOfError
      : leadPercent > 0
        ? Infinity
        : 0;

  return {
    ...results,
    marginOfError,
    leaders: {
      ...results.leaders,
      predictionStatus: predictionStatusFromRatio(ratio),
    },
  };
}

function calculatePartyVote(results: ElectorateResults[]): VotingResults[] {
  const partyVoteMap = new Map<string, number>();
  const allPartyVotes = results.flatMap((x) => x.partyVotes);
  allPartyVotes.forEach((x) => {
    const partyVotes = partyVoteMap.get(x.candidate);
    if (partyVotes) {
      partyVoteMap.set(x.candidate, partyVotes + x.votes);
    } else {
      partyVoteMap.set(x.candidate, x.votes);
    }
  });
  return Array.from(partyVoteMap.entries()).map(([candidate, votes]) => ({
    candidate,
    votes,
  }));
}

function aggregateVotesCounted(results: ElectorateResults[]) {
  const votesCounted = results.reduce((prev, x) => prev + x.votesCounted, 0);
  const totalVotes = results.reduce(
    (prev, x) => prev + x.votesCounted / x.votePercentageCounted,
    0
  );

  return { votesCounted, totalVotes };
}

function calculatePartyVoteWithPercentages(
  results: ElectorateResults[],
  confidence: number
): (VotingResults & WithPercentages)[] {
  const { votesCounted, totalVotes } = aggregateVotesCounted(results);
  const votes = calculatePartyVote(results);

  return votes.map((x) => ({
    ...x,
    percentage: x.votes / votesCounted,
    marginOfError: calculateMarginOfError(
      x.votes / votesCounted,
      votesCounted,
      totalVotes,
      confidence
    ),
  }));
}

function calculateElectorateWinSeats(
  electorateVotes: (ElectorateResults & WithLeaders)[]
): Record<string, number> {
  return electorateVotes.reduce(
    (acc, r) => {
      const party = r.leaders.leadingCandidateParty;
      if (!party) return acc;
      if (!acc[party]) {
        acc[party] = 1;
        return acc;
      }
      acc[party] += 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

function calculatePartyVoteWithSeats(
  partyVotes: (VotingResults & WithPercentages)[],
  electorateVotes: (ElectorateResults & WithLeaders)[]
): (VotingResults & WithSeats)[] {
  const partiesWithElectorateWins = Array.from(
    new Set(electorateVotes.map((x) => x.leaders.leadingCandidateParty))
  ).filter((p): p is string => !!p);
  const electorateSeats = calculateElectorateWinSeats(electorateVotes);

  const eligibleResults = partyVotes.filter(
    (x) =>
      x.percentage >= 0.05 || partiesWithElectorateWins.includes(x.candidate)
  );

  const resultsMap = eligibleResults.reduce(
    (map, { candidate, votes }) => {
      const updated = { ...map };
      updated[candidate] = votes;
      return updated;
    },
    {} as Record<string, number>
  );
  const entitlement =
    Object.keys(resultsMap).length > 0
      ? sainteLague(resultsMap, 120, { draw: true })
      : {};

  return partyVotes.map((x) => {
    const electorates = electorateSeats[x.candidate] || 0;
    const allocated = entitlement[x.candidate] || 0;
    // Overhang: if a party wins more electorates than its proportional entitlement,
    // it keeps all electorates and the parliament grows (no compensatory seats).
    const totalSeats = Math.max(allocated, electorates);
    const listSeats = totalSeats - electorates;
    return {
      ...x,
      seats: totalSeats,
      electorateSeats: electorates,
      listSeats,
    };
  });
}

function getElectorateWinners(
  electoralVotes: (ElectorateResults & WithLeaders)[]
): Record<string, string[]> {
  return electoralVotes.reduce(
    (acc, r) => {
      const party = r.leaders.leadingCandidateParty;
      if (!party) return acc;
      if (!acc[party]) {
        acc[party] = [r.leaders.leadingCandidate];
        return acc;
      }
      acc[party] = [...acc[party], r.leaders.leadingCandidate];
      return acc;
    },
    {} as Record<string, string[]>
  );
}

function higherRankedWinners(
  list: PartyList[],
  winners: Record<string, string[]>,
  candidate: PartyList
): PartyList[] {
  return list.filter(
    (x) =>
      x.listRank < candidate.listRank &&
      x.party === candidate.party &&
      winners[x.party]?.includes(x.candidate)
  );
}

function calculatePartyList(
  electoralVotes: (ElectorateResults & WithLeaders)[],
  seats: (VotingResults & WithSeats)[],
  list: PartyList[]
): (PartyList & WithAdjustedRank)[] {
  const winners = getElectorateWinners(electoralVotes);
  const withAdjustedRank = list.map((x) => ({
    ...x,
    adjustedRank:
      x.listRank - (higherRankedWinners(list, winners, x).length || 0),
  }));
  const withCutDistance = withAdjustedRank.map((x) => ({
    ...x,
    distanceFromCut:
      (seats.find((y) => y.candidate === x.party)?.listSeats || 0) -
      x.adjustedRank,
  }));

  return withCutDistance;
}

export {
  calculateLead,
  predictWinner,
  predictionStatusFromRatio,
  calculatePartyVoteWithPercentages,
  calculatePartyVoteWithSeats,
  calculatePartyList,
};
