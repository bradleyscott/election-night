import { Config } from './types.js';

const BASE_RESULTS_URL =
  process.env.BASE_RESULTS_URL ||
  'https://electionresults.govt.nz/electionresults_2023';

const RESULTS_TABLE_SELECTOR =
  process.env.RESULTS_TABLE_SELECTOR ||
  '#electorate_details_partycandidate_content';

const VOTE_PERCENT_COUNTED_SELECTOR =
  process.env.VOTE_PERCENT_COUNTED_SELECTOR ||
  '#electorate_details_table > tbody > tr:nth-child(1) > td:nth-child(3) > div';

const VOTES_COUNTED_SELECTOR =
  process.env.VOTES_COUNTED_SELECTOR ||
  '#electorate_details_table > tbody > tr:nth-child(1) > td:nth-child(2) > div';

export const config: Config = {
  predictionConfidence: 0.95,
  cachePaths: {
    electoralResults: '.cache/electorate_results.json',
  },
  webhookUrl: process.env.WEBHOOK_URL,
};

export {
  BASE_RESULTS_URL,
  RESULTS_TABLE_SELECTOR,
  VOTE_PERCENT_COUNTED_SELECTOR,
  VOTES_COUNTED_SELECTOR,
};
