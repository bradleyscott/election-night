import {
  ElectorateResults,
  NationalStatus,
  PartyList,
  ResultsPayload,
  VotingResults,
  WithLeaders,
  WithPercentages,
  WithSeats,
  WithAdjustedRank,
} from './types.js';

function calculateLead(
  results: ElectorateResults
): ElectorateResults & WithLeaders {
  const sortedCandidates = [...results.candidateVotes].sort(
    (a, b) => b.votes - a.votes
  );

  const leadingCandidate = sortedCandidates[0]?.candidate ?? '';
  const leadingCandidateParty = sortedCandidates[0]?.party;
  const secondCandidate = sortedCandidates[1]?.candidate ?? '';
  const secondCandidateParty = sortedCandidates[1]?.party;
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

function calculatePartyVoteWithPercentages(
  results: ElectorateResults[]
): (VotingResults & WithPercentages)[] {
  const votesCounted = results.reduce((prev, x) => prev + x.votesCounted, 0);
  const votes = calculatePartyVote(results);

  return votes.map((x) => ({
    ...x,
    percentage: votesCounted > 0 ? x.votes / votesCounted : 0,
  }));
}

/**
 * Attach the Commission's own seat allocation to each party's vote row.
 *
 * Seats are not ours to derive: `election.xml` publishes list, electorate and
 * total seats per party, including the threshold rule and any overhang, and it
 * is the same table the results website renders. The party's own share comes
 * from our count; the seat numbers are the Commission's.
 */
function buildPartyVoteWithSeats(
  partyVotes: (VotingResults & WithPercentages)[],
  status: NationalStatus
): (VotingResults & WithPercentages & WithSeats)[] {
  const byParty = new Map(partyVotes.map((x) => [x.candidate, x]));
  return status.parties
    .map((p) => {
      const aggregate = byParty.get(p.party);
      return {
        candidate: p.party,
        votes: p.votes,
        percentage: aggregate?.percentage ?? 0,
        seats: p.totalSeats,
        electorateSeats: p.electorateSeats,
        listSeats: p.listSeats,
      };
    })
    .sort(
      (a, b) => b.votes - a.votes || a.candidate.localeCompare(b.candidate)
    );
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

/**
 * The whole reduction, raw electorate results + party lists → the payload the
 * dashboard consumes.
 *
 * Shared by the live scrape loop and by `ElectionResultsService` when it
 * fetches an archived cycle, so a historical year goes through exactly the
 * same leaders and seat maths as the live one.
 */
function buildResultsPayload(
  results: ElectorateResults[],
  partyListRecords: PartyList[],
  nationalStatus: NationalStatus
): ResultsPayload {
  const withPredictions = results.map((x) =>
    calculateLead({ ...x, candidateVotes: [...x.candidateVotes] })
  );

  const partyVote = buildPartyVoteWithSeats(
    calculatePartyVoteWithPercentages(withPredictions),
    nationalStatus
  );

  return {
    electorateResults: withPredictions,
    partyVote,
    partyLists: calculatePartyList(
      withPredictions,
      partyVote,
      partyListRecords
    ),
  };
}

export {
  calculateLead,
  calculatePartyVoteWithPercentages,
  buildPartyVoteWithSeats,
  calculatePartyList,
  buildResultsPayload,
};
