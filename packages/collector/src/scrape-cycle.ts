import type { Browser } from 'puppeteer-core';
import pLimit from 'p-limit';
import { config } from '@election-night/core/config';
import type {
  ElectorateConfig,
  ElectorateResults,
  ElectionSource,
  PartyList,
  ResultsPayload,
} from '@election-night/core/types';
import {
  calculateLead,
  calculatePartyList,
  calculatePartyVoteWithPercentages,
  calculatePartyVoteWithSeats,
  predictWinner,
} from '@election-night/core/reducers';
import { log } from './logger.js';
import { getElectoratePageHtml } from './scraper.js';

export type ScrapeCycleOptions = {
  browser: Browser;
  source: ElectionSource;
  configs: ElectorateConfig[];
  candidateRecords: Record<string, string>[];
  partyMap: Record<string, string | undefined>;
  partyListRecords: PartyList[];
  concurrency: number;
};

export async function scrapeCycle(
  options: ScrapeCycleOptions
): Promise<ResultsPayload> {
  const {
    browser,
    source,
    configs,
    candidateRecords,
    partyMap,
    partyListRecords,
    concurrency,
  } = options;
  const limit = pLimit(concurrency);

  log.info('Starting election results scraping...');

  const settled = await Promise.allSettled(
    configs.map((cfg) =>
      limit(() =>
        getElectoratePageHtml(browser, cfg).then((html) => ({
          html,
          config: cfg,
        }))
      )
    )
  );

  const results: ElectorateResults[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const raw = source.parseRawResults(s.value.html, s.value.config);
      const electorateResults: ElectorateResults = {
        electorateName: raw.electorateName,
        partyVotes: raw.partyVotes,
        candidateVotes: raw.candidateVotes.map((cv) => ({
          ...cv,
          party: candidateRecords.find((r) => r.Name === cv.candidate)?.Party,
        })),
        votesCounted: raw.votesCounted,
        votePercentageCounted: raw.votePercentageCounted,
      };
      log.debug(
        `${electorateResults.electorateName}: ${electorateResults.candidateVotes.length} candidates, ${electorateResults.partyVotes.length} party entries, votesCounted=${electorateResults.votesCounted}, pct=${electorateResults.votePercentageCounted}`
      );
      if (electorateResults.candidateVotes.length > 0) {
        log.trace(
          `${electorateResults.electorateName} top candidate: ${electorateResults.candidateVotes[0].candidate} (${electorateResults.candidateVotes[0].votes} votes)`
        );
        if (electorateResults.partyVotes.length > 0) {
          log.trace(
            `${electorateResults.electorateName} top party: ${electorateResults.partyVotes[0].candidate} (${electorateResults.partyVotes[0].votes} votes)`
          );
        }
      }
      results.push(electorateResults);
    } else {
      log.error(`Failed to scrape electorate`, s.reason);
    }
  }

  const totalVotes = results.reduce((s, r) => s + (r.votesCounted || 0), 0);
  log.info(
    `Finished scraping ${results.length}/${configs.length} electorates (total votes counted: ${totalVotes.toLocaleString()})`
  );
  if (results.length > 0) {
    const zeroVoteElectorates = results.filter(
      (r) => (r.votesCounted || 0) === 0
    ).length;
    if (zeroVoteElectorates > 0) {
      log.warn(`${zeroVoteElectorates} electorates have 0 votes counted`);
    }
  }

  const withPredictions = results
    .map((x) =>
      calculateLead({ ...x, candidateVotes: [...x.candidateVotes] }, partyMap)
    )
    .map((x) => predictWinner(x, config.predictionConfidence));

  const partyVote = calculatePartyVoteWithSeats(
    calculatePartyVoteWithPercentages(
      withPredictions,
      config.predictionConfidence
    ),
    withPredictions
  );

  const partyLists = calculatePartyList(
    withPredictions,
    partyVote,
    partyListRecords
  );

  const totalSeats = partyVote.reduce((s, p) => s + p.seats, 0);
  const partiesInParliament = partyVote.filter((p) => p.seats > 0).length;
  log.info(
    `Party votes: ${partyVote.length} parties, ${totalSeats} total seats, ${partiesInParliament} parties in parliament`
  );
  if (partyVote.length > 0) {
    log.debug(
      `Top 3 parties: ${[...partyVote]
        .sort((a, b) => b.seats - a.seats)
        .slice(0, 3)
        .map((p) => `${p.candidate} (${p.seats} seats)`)
        .join(', ')}`
    );
  }
  if (totalSeats === 0) {
    log.warn('Total seats is 0 — party vote calculation produced no seats');
  }

  const totalListCandidates = partyLists.filter(
    (pl) => pl.distanceFromCut >= 0
  ).length;
  log.debug(`${totalListCandidates} list candidates above the cut`);

  return {
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  };
}
