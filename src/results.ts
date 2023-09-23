import { writeFileSync, readFileSync } from 'fs';
import {
  ElectorateResults,
  WithPercentages,
  WithLeaders,
  VotingResults,
  WithSeats,
} from './types.js';
import { config } from './config.js';

type Results = ElectorateResults & WithPercentages & WithLeaders;

let electorateResults: Results[];

export function cacheResults(toCache: Results[]) {
  electorateResults = toCache;
  writeFileSync(
    config.cachePaths.electoralResults,
    JSON.stringify(toCache, null, 2)
  );
}

function readResults(): Results[] {
  if (electorateResults) {
    return electorateResults;
  }
  const resultsString = readFileSync(
    config.cachePaths.electoralResults,
    'utf8'
  );
  return JSON.parse(resultsString);
}

export function isResultUpdated(result: Results): boolean {
  const results = readResults();
  const matchingResult = results.find(
    (x) => x.electorateName === result.electorateName
  );
  if (!matchingResult) {
    return false;
  }
  return matchingResult.votePercentageCounted !== result.votePercentageCounted;
}

export function hasLeaderChanged(result: Results) {
  const results = readResults();
  const matchingResult = results.find(
    (x) => x.electorateName === result.electorateName
  );
  if (!matchingResult) {
    return false;
  }
  return (
    matchingResult.leaders.leadingCandidateParty !==
    result.leaders.leadingCandidateParty
  );
}

export function hasNewPrediction(result: Results) {
  const results = readResults();
  const matchingResult = results.find(
    (x) => x.electorateName === result.electorateName
  );
  if (!matchingResult) {
    return false;
  }
  return (
    matchingResult.leaders.isPredictedWinner !==
    result.leaders.isPredictedWinner
  );
}

export const processUpdatedResult = (result: (VotingResults & WithSeats)[]) =>
  post(config.webhooks.updatedResultWebhookUrl, result);

export const processLeaderChange = (result: Results) =>
  post(config.webhooks.leaderChangeWebhookUrl, { ...result });

export const processNewPrediction = async (result: Results) =>
  post(config.webhooks.newPredictionWebhookUrl, { ...result });

async function post(url: string, body: unknown) {
  try {
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    console.error(e);
  }
}
