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
  /** The real count's `total_votes_cast`, including informal papers. */
  totalVotesCast: number;
  /** Enrolled electors, so turnout is votes ÷ roll rather than a flat guess. */
  enrolment: number | null;
};

/**
 * A partial count of a real electorate.
 *
 * The full stage is the published result unchanged. Earlier stages scale both
 * the candidate vote and the party vote by the same share, so a seat's leaning
 * does not change as the night goes on — only how much of it has reported.
 *
 * Candidate votes and party votes are scaled independently. Their totals need
 * not equal `votesCounted`: the feed's `total_votes_cast` includes informal
 * papers, exactly as it does in production, and the mock used to hide that by
 * forcing the parts to add up.
 */
export function generatePartialResults(
  electorate: SyntheticElectorate,
  percentCounted: number
): ElectorateResults {
  const votesCounted = Math.round(electorate.totalVotesCast * percentCounted);

  const candidateVotes = electorate.candidates.map((candidate) => ({
    candidate: candidate.name,
    votes: Math.round(candidate.finalVotes * percentCounted),
    party: candidate.party,
  }));

  const partyVotes = electorate.parties.map((party, index) => ({
    candidate: party,
    votes: Math.round(electorate.partyVoteFinal[index]! * percentCounted),
  }));

  const percentVotesCast =
    electorate.enrolment && electorate.enrolment > 0
      ? votesCounted / electorate.enrolment
      : undefined;

  return {
    electorateName: electorate.name,
    candidateVotes,
    partyVotes,
    votesCounted,
    votePercentageCounted: percentCounted,
    percentVotesCast,
  };
}
