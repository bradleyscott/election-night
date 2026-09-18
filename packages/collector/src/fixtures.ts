import type {
  ElectorateResults,
  VotingResults,
  WithPercentages,
  WithLeaders,
} from '@election-night/core/types';
import electorateVotesJson from './fixtures/electorate-votes.json';
import partyVotesJson from './fixtures/party-votes.json';

export type FixtureElectorateResults = ElectorateResults & WithLeaders;

export const electorateVotes =
  electorateVotesJson as unknown as FixtureElectorateResults[];

export const partyVotes = partyVotesJson as unknown as (VotingResults &
  WithPercentages)[];
