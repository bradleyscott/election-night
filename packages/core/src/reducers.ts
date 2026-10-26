import jstat from 'jstat';
import { config } from './config.js';
import {
  ElectorateResults,
  NationalStatus,
  PartyList,
  PredictionStatus,
  ResultsPayload,
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
  if (sample <= 0 || population <= 0 || !Number.isFinite(resultAsPercentage)) {
    return 0;
  }
  const zScore = jstat.normal.inv(1 - (1 - confidence) / 2, 0, 1);
  const finitePopulationCorrection = Math.sqrt(
    (population - sample) / (population - 1)
  );
  const marginOfError =
    zScore *
    Math.sqrt((resultAsPercentage * (1 - resultAsPercentage)) / sample) *
    finitePopulationCorrection;

  return Number.isFinite(marginOfError) ? marginOfError : 0;
}

function predictionStatusFromRatio(ratio: number): PredictionStatus {
  if (ratio > 2) return 'projected';
  if (ratio > 1.5) return 'likely';
  if (ratio > 1) return 'leaning';
  return 'too-close';
}

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
      predictionStatus: 'too-close',
    },
  };
}

function predictWinner(
  results: ElectorateResults & WithLeaders,
  confidence: number
): ElectorateResults & WithLeaders & WithMarginOfError {
  const votesCounted = results.votesCounted;
  const votePercentageCounted = results.votePercentageCounted;

  if (
    votesCounted <= 0 ||
    votePercentageCounted <= 0 ||
    !Number.isFinite(votePercentageCounted)
  ) {
    return {
      ...results,
      marginOfError: 0,
      leaders: {
        ...results.leaders,
        predictionStatus: 'too-close',
      },
    };
  }

  const totalVotes = votesCounted / votePercentageCounted;
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
    marginOfError: Number.isFinite(marginOfError) ? marginOfError : 0,
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
  const totalVotes = results.reduce((prev, x) => {
    const pct = x.votePercentageCounted;
    return pct > 0 && Number.isFinite(pct) ? prev + x.votesCounted / pct : prev;
  }, 0);

  return { votesCounted, totalVotes };
}

function calculatePartyVoteWithPercentages(
  results: ElectorateResults[],
  confidence: number
): (VotingResults & WithPercentages)[] {
  const { votesCounted, totalVotes } = aggregateVotesCounted(results);
  const votes = calculatePartyVote(results);

  if (votesCounted <= 0) {
    return votes.map((x) => ({
      ...x,
      percentage: 0,
      marginOfError: 0,
    }));
  }

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

/**
 * Attach the Commission's own seat allocation to each party's vote row.
 *
 * Seats are not ours to derive: `election.xml` publishes list, electorate and
 * total seats per party, including the threshold rule and any overhang, and it
 * is the same table the results website renders. The only thing we add is the
 * margin of error, which is a property of the count, not of the seat rules.
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
        marginOfError: aggregate?.marginOfError ?? 0,
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
 * same leaders, margin-of-error and seat maths as the live one.
 */
function buildResultsPayload(
  results: ElectorateResults[],
  partyListRecords: PartyList[],
  nationalStatus: NationalStatus,
  confidence: number = config.predictionConfidence
): ResultsPayload {
  const withPredictions = results
    .map((x) => calculateLead({ ...x, candidateVotes: [...x.candidateVotes] }))
    .map((x) => predictWinner(x, confidence));

  const partyVote = buildPartyVoteWithSeats(
    calculatePartyVoteWithPercentages(withPredictions, confidence),
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
  predictWinner,
  predictionStatusFromRatio,
  calculatePartyVoteWithPercentages,
  buildPartyVoteWithSeats,
  calculatePartyList,
  buildResultsPayload,
};
