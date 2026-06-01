import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import {
  earlyCountResults,
  midCountResults,
  lateCountResults,
  fullCountResults,
} from './synthetic-electorates.js';
import type { ElectorateResults, PartyList } from '@election-night/core/types';
import {
  calculatePartyVoteWithPercentages,
  calculatePartyVoteWithSeats,
  predictWinner,
  calculatePartyList,
} from '@election-night/core/reducers';
import { config } from '@election-night/core/config';
import { connectWs, publishResults, disconnectWs } from './ws-client.js';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CSV_PARTY_LIST = readFileSync(
  resolve(__dirname, '../../../csv/party_list.csv'),
  'utf-8'
);
const partyListRecords: PartyList[] = parse(CSV_PARTY_LIST, { columns: true }).map(
  (x: Record<string, string>) => ({
    party: x.Party,
    candidate: `${x['Ballot Last Name']}, ${x['Ballot First Name']}`,
    listRank: Number(x['List No.']),
  })
);

function calculateLead(results: ElectorateResults) {
  results.candidateVotes.sort((a, b) => b.votes - a.votes);
  const leadingCandidate = results.candidateVotes[0].candidate;
  const secondCandidate = results.candidateVotes[1].candidate;
  const margin = results.candidateVotes[0].votes - results.candidateVotes[1].votes;
  const marginPercent = margin / results.votesCounted;

  return {
    ...results,
    leaders: {
      leadingCandidate,
      leadingCandidateParty: results.candidateVotes[0].party,
      secondCandidate,
      secondCandidateParty: results.candidateVotes[1].party,
      margin,
      marginPercent,
      isPredictedWinner: false,
    },
  };
}

function processStage(results: ElectorateResults[], label: string) {
  log.info(`Processing ${label} (${results.length} electorates)`);

  const withPredictions = results
    .map(calculateLead)
    .map((x) => predictWinner(x, config.predictionConfidence));

  const partyVote = calculatePartyVoteWithSeats(
    calculatePartyVoteWithPercentages(
      withPredictions,
      config.predictionConfidence
    ),
    withPredictions
  );

  const partyLists = calculatePartyList(withPredictions, partyVote, partyListRecords);

  publishResults({
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  });

  log.info(`Published ${label} results`);
}

const WS_PORT = parseInt(process.env.WS_PORT || '3456', 10);
const WS_URL = process.env.WS_URL || `ws://localhost:${WS_PORT}`;

connectWs(WS_URL);

const args = process.argv.slice(2);
const fast = args.includes('--fast');

const stepIndex = args.indexOf('--step');
if (stepIndex !== -1 && args[stepIndex + 1]) {
  const step = args[stepIndex + 1];
  const stageMap: Record<string, ElectorateResults[]> = {
    early: earlyCountResults,
    mid: midCountResults,
    late: lateCountResults,
    full: fullCountResults,
  };

  if (!stageMap[step]) {
    log.error(`Unknown step "${step}". Use: early, mid, late, full`);
    process.exit(1);
  }

  const interval = fast ? 15000 : 60000;
  const results = stageMap[step];

  function tick() {
    processStage(results, step);
    setTimeout(tick, interval);
  }

  setTimeout(tick, 2000);
} else {
  const interval = fast ? 15000 : 60000;
  const stages = [
    { label: 'early', results: earlyCountResults },
    { label: 'mid', results: midCountResults },
    { label: 'late', results: lateCountResults },
    { label: 'full', results: fullCountResults },
  ];

  let stageIndex = 0;

  function tick() {
    const { label, results } = stages[stageIndex];
    processStage(results, label);
    stageIndex = (stageIndex + 1) % stages.length;
    setTimeout(tick, interval);
  }

  setTimeout(tick, 2000);
}

process.on('SIGINT', () => {
  disconnectWs();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectWs();
  process.exit(0);
});
