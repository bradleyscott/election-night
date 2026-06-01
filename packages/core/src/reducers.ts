import sainteLague from 'sainte-lague';
import jstat from 'jstat';
import {
  ElectorateResults,
  PartyList,
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

function calculateLead(
  results: ElectorateResults,
  partyMap: Record<string, string | undefined>
): ElectorateResults & WithLeaders {
  const sortedCandidates = results.candidateVotes.sort(
    (a, b) => b.votes - a.votes
  );
  const leadingCandidate = sortedCandidates[0].candidate;
  const leadingCandidateParty = partyMap[leadingCandidate];
  const secondCandidate = sortedCandidates[1].candidate;
  const secondCandidateParty = partyMap[secondCandidate];
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

function predictWinner(
  results: ElectorateResults & WithLeaders,
  confidence: number
): ElectorateResults & WithLeaders & WithMarginOfError {
  const resultsWithWinner = { ...results } as ElectorateResults &
    WithLeaders &
    WithMarginOfError;
  const votesCounted = results.votesCounted;
  const totalVotes = votesCounted / results.votePercentageCounted;
  const leadingShare = results.candidateVotes[0].votes / votesCounted;
  const secondShare = results.candidateVotes[1].votes / votesCounted;
  const leadPercent = leadingShare - secondShare;

  const zScore = jstat.normal.inv(1 - (1 - confidence) / 2, 0, 1);
  const finitePopulationCorrection = Math.sqrt(
    (totalVotes - votesCounted) / (totalVotes - 1)
  );
  const diffVariance =
    (leadingShare + secondShare - leadPercent * leadPercent) / votesCounted;

  resultsWithWinner.marginOfError =
    zScore * Math.sqrt(diffVariance) * finitePopulationCorrection;

  if (leadPercent <= resultsWithWinner.marginOfError) {
    return resultsWithWinner;
  }

  resultsWithWinner.leaders.isPredictedWinner = true;
  return resultsWithWinner;
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
  );
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
  const seats = sainteLague(resultsMap, 120, { draw: true });

  return partyVotes.map((x) => ({
    ...x,
    seats: seats[x.candidate] || 0,
    electorateSeats: electorateSeats[x.candidate] || 0,
    listSeats: (seats[x.candidate] || 0) - (electorateSeats[x.candidate] || 0),
  }));
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
  calculatePartyVoteWithPercentages,
  calculatePartyVoteWithSeats,
  calculatePartyList,
};
