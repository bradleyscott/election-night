import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import { config } from '@election-night/core/config';

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

let electorateResults: Results[];

export function cacheResults(toCache: Results[]) {
  electorateResults = toCache;
  mkdirSync(dirname(config.cachePaths.electoralResults), { recursive: true });
  writeFileSync(
    config.cachePaths.electoralResults,
    JSON.stringify(toCache, null, 2)
  );
}

function readResults(): Results[] {
  if (electorateResults) {
    return electorateResults;
  }
  try {
    const resultsString = readFileSync(
      config.cachePaths.electoralResults,
      'utf8'
    );
    return JSON.parse(resultsString);
  } catch {
    return [];
  }
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

export const processLeaderChange = (result: Results) =>
  post(config.webhooks.leaderChangeWebhookUrl ?? '', { ...result });

export const processNewPrediction = async (result: Results) =>
  post(config.webhooks.newPredictionWebhookUrl ?? '', { ...result });

async function post(url: string, body: unknown) {
  if (!url) return;
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
