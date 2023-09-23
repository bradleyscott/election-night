import { JWT } from 'google-auth-library';
import { Config } from './types.js';
import 'dotenv/config';

const BASE_RESULTS_URL =
  process.env.BASE_RESULTS_URL ||
  'https://electionresults.govt.nz/electionresults_2023';
const electorateNames = [
  'Auckland Central',
  'Banks Peninsula',
  'Bay of Plenty',
  'Botany',
  'Christchurch Central',
  'Christchurch East',
  'Coromandel',
  'Dunedin',
  'East Coast',
  'East Coast Bays',
  'Epsom',
  'Hamilton East',
  'Hamilton West',
  'Hutt South',
  'Ilam',
  'Invercargill',
  'Kaikōura',
  'Kaipara ki Mahurangi',
  'Kelston',
  'Mana',
  'Māngere',
  'Manurewa',
  'Maungakiekie',
  'Mt Albert',
  'Mt Roskill',
  'Napier',
  'Nelson',
  'New Lynn',
  'New Plymouth',
  'North Shore',
  'Northcote',
  'Northland',
  'Ōhāriu',
  'Ōtaki',
  'Pakuranga',
  'Palmerston North',
  'Panmure-Ōtāhuhu',
  'Papakura',
  'Port Waikato',
  'Rangitata',
  'Rangitīkei',
  'Remutaka',
  'Rongotai',
  'Rotorua',
  'Selwyn',
  'Southland',
  'Taieri',
  'Takanini',
  'Tāmaki',
  'Taranaki-King Country',
  'Taupō',
  'Tauranga',
  'Te Atatū',
  'Tukituki',
  'Upper Harbour',
  'Waikato',
  'Waimakariri',
  'Wairarapa',
  'Waitaki',
  'Wellington Central',
  'West Coast-Tasman',
  'Whanganui',
  'Whangaparāoa',
  'Whangārei',
  'Wigram',
  'Hauraki-Waikato',
  'Ikaroa-Rāwhiti',
  'Tāmaki Makaurau',
  'Te Tai Hauāuru',
  'Te Tai Tokerau',
  'Te Tai Tonga',
  'Waiariki',
];

export const config: Config = {
  predictionConfidence: 0.95,
  resultUrls: {
    electorates: electorateNames.map((name, index) => ({
      electorateName: name,
      url:
        index < 9
          ? `${BASE_RESULTS_URL}/electorate-details-0${index + 1}.html`
          : `${BASE_RESULTS_URL}/electorate-details-${index + 1}.html`,
    })),
  },
  parser: {
    resultsTableSelector:
      process.env.RESULTS_TABLE_SELECTOR ||
      '#electorate_details_partycandidate_content',
    votePercentCountedSelector:
      process.env.VOTE_PERCENT_COUNTED_SELECTOR ||
      '#electorate_details_table > tbody > tr:nth-child(1) > td:nth-child(3) > div',
    votesCountedSelector:
      process.env.VOTES_COUNTED_SELECTOR ||
      '#electorate_details_table > tbody > tr:nth-child(1) > td:nth-child(2) > div',
  },
  cachePaths: {
    electoralResults: '.cache/electorate_results.json',
  },
  webhooks: {
    newPredictionWebhookUrl: process.env.NEW_PREDICTION_WEBHOOK_URL,
    updatedResultWebhookUrl: process.env.UPDATED_RESULT_WEBHOOK_URL,
    leaderChangeWebhookUrl: process.env.LEADER_CHANGE_WEBHOOK_URL,
  },
  googleSheets: {
    sheetId: process.env.RESULTS_SHEET_ID,
    credentials: new JWT({
      email: process.env.GSHEETS_CLIENT_EMAIL || '',
      key: process.env.GSHEETS_PRIVATE_KEY || '',
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    }),
    electorateResultsSheetName:
      process.env.ELECTORATE_RESULTS_SHEET_NAME || 'electoral_results',
    electorateResultsSummarySheetName:
      process.env.ELECTORATE_RESULTS_SUMMARY_SHEET_NAME ||
      'electoral_results_summary',
    partyVoteResultsSheetName:
      process.env.PARTY_VOTE_RESULTS_SHEET_NAME || 'party_vote_results',
    partyVoteSummarySheetName:
      process.env.PARTY_VOTE_SUMMARY_SHEET_NAME || 'party_vote_summary',
    partyListsSheetName: process.env.PARTY_LISTS_SHEET_NAME || 'party_lists',
  },
};
