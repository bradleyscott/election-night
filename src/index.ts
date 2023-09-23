import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from './config.js';
import {
  calculateLead,
  calculatePartyVoteWithPercentages,
  calculatePartyVoteWithSeats,
  predictWinner,
  calculatePartyList,
} from './reducers.js';
import { getElectoratePageHtml, getElectorateResults } from './scraper.js';
import {
  cacheResults,
  hasLeaderChanged,
  hasNewPrediction,
  processLeaderChange,
  processNewPrediction,
} from './results.js';
import { log } from './logger.js';
import {
  writeElectorateResults,
  writeElectorateResultsSummary,
  writePartyLists,
  writePartyVoteResults,
  writePartyVoteSummary,
} from './gSheets.js';

const EXECUTION_FREQUENCY = 1000 * 60 * 2; // Every 2 minutes

const run = async () => {
  log.info('Starting election results scraping...');

  puppeteer.use(StealthPlugin());
  const browser = await puppeteer.launch({ headless: 'new' });
  const promises = config.resultUrls.electorates.map((x) =>
    getElectoratePageHtml(browser, x)
  );
  const html = await Promise.all(promises);

  const results = html.map((h, index) =>
    getElectorateResults(h, config.resultUrls.electorates[index])
  );
  browser.close();

  log.info('Finished scraping election results');

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

  const partyLists = calculatePartyList(withPredictions, partyVote);

  await Promise.all(
    withPredictions.filter(hasLeaderChanged).map(processLeaderChange)
  );

  await Promise.all(
    withPredictions.filter(hasNewPrediction).map(processNewPrediction)
  );

  writeElectorateResults(withPredictions);
  writeElectorateResultsSummary(withPredictions);
  writePartyVoteResults(withPredictions);
  writePartyVoteSummary(partyVote);
  writePartyLists(partyLists);
  cacheResults(withPredictions);

  log.info('Processing of results completed!');
};

const loopRun = () => {
  run();
  setTimeout(loopRun, EXECUTION_FREQUENCY);
};
loopRun();
