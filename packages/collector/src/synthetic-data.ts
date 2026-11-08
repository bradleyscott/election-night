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

/**
 * A partial count of a synthetic electorate.
 *
 * Rounding each candidate and party vote independently would break the feed's
 * own invariant that the parts sum to `votes_counted`, so the remainder is put
 * on the largest line rather than dropped.
 */
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
