import sainteLague from 'sainte-lague';
import jstat from 'jstat';
import { parse } from 'csv-parse/sync';
import {
  ElectorateResults,
  PartyList,
  VotingResults,
  WithLeaders,
  WithPercentages,
  WithSeats,
  WithAdjustedRank,
} from './types.js';
import { candidatesCsv, partyListCsv } from './candidates.js';

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
  results: ElectorateResults & WithPercentages
): ElectorateResults & WithPercentages & WithLeaders {
  const sortedCandidates = results.candidateVotes.sort(
    (a, b) => b.votes - a.votes
  );
  const leadingCandidate = sortedCandidates[0].candidate;
  const leadingCandidateParty = resolvePartyAffiliation(leadingCandidate);
  const secondCandidate = sortedCandidates[1].candidate;
  const secondCandidateParty = resolvePartyAffiliation(secondCandidate);
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
  results: ElectorateResults & WithPercentages & WithLeaders,
  confidence: number
): ElectorateResults & WithPercentages & WithLeaders {
  const resultsWithWinner = { ...results };
  const leadPercent = results.leaders.margin / results.votesCounted;
  resultsWithWinner.marginOfError = calculateMarginOfError(
    leadPercent,
    results.votesCounted,
    results.votesCounted / results.votePercentageCounted,
    confidence
  );

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
): { [key: string]: number } {
  return electorateVotes.reduce((acc, r) => {
    if (!acc[r.leaders.leadingCandidateParty]) {
      acc[r.leaders.leadingCandidateParty] = 1;
      return acc;
    }
    acc[r.leaders.leadingCandidateParty] += 1;
    return acc;
  }, {});
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

  const resultsMap = eligibleResults.reduce((map, { candidate, votes }) => {
    const updated = { ...map };
    updated[candidate] = votes;
    return updated;
  }, {});
  const seats = sainteLague(resultsMap, 120, { draw: true });

  return partyVotes.map((x) => ({
    ...x,
    seats: seats[x.candidate] || 0,
    electorateSeats: electorateSeats[x.candidate] || 0,
    listSeats: (seats[x.candidate] || 0) - (electorateSeats[x.candidate] || 0),
  }));
}

function resolvePartyAffiliation(candidate: string): string | undefined {
  const records = parse(candidatesCsv(), { columns: true });
  return records.find((x) => x.Name === candidate)?.Party;
}

function getElectorateWinners(
  electoralVotes: (ElectorateResults & WithLeaders)[]
): { [key: string]: string[] } {
  return electoralVotes.reduce((acc, r) => {
    if (!acc[r.leaders.leadingCandidateParty]) {
      acc[r.leaders.leadingCandidateParty] = [r.leaders.leadingCandidate];
      return acc;
    }
    acc[r.leaders.leadingCandidateParty] = [
      ...acc[r.leaders.leadingCandidateParty],
      r.leaders.leadingCandidate,
    ];
    return acc;
  }, {});
}

function higherRankedWinners(
  list: PartyList[],
  winners: { [key: string]: string[] },
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
  seats: (VotingResults & WithSeats)[]
): (PartyList & WithAdjustedRank)[] {
  const list: PartyList[] = parse(partyListCsv(), { columns: true }).map(
    (x) => ({
      party: x.Party,
      candidate: `${x['Ballot Last Name']}, ${x['Ballot First Name']}`,
      listRank: x['List No.'],
    })
  );

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
  resolvePartyAffiliation,
  calculatePartyList,
};
