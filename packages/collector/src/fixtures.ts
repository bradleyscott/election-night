import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type {
  ElectorateResults,
  VotingResults,
  WithPercentages,
  WithLeaders,
} from '@election-night/core/types';
import electorateVotesJson from './fixtures/electorate-votes.json';
import partyVotesJson from './fixtures/party-votes.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type FixtureElectorateResults = ElectorateResults & WithLeaders;

export const electorateVotes =
  electorateVotesJson as unknown as FixtureElectorateResults[];

export const partyVotes = partyVotesJson as unknown as (VotingResults &
  WithPercentages)[];

/** Sample scraped results page matching the NZ Electoral Commission markup. */
export const html: string = readFileSync(
  resolve(__dirname, 'fixtures/fixture.html'),
  'utf-8'
);
