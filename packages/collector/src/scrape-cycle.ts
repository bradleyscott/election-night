import type { BrowserContext } from 'playwright-core';
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
import { getElectoratePageHtml, sleep } from './scraper.js';
import { collectorConfig } from './config.js';
import { publishMetrics } from './ws-client.js';
import { readResults } from './results.js';
import { emitScrapeDuration, emitScrapeElectorate } from './metrics.js';

export type ScrapeCycleOptions = {
  context: BrowserContext;
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
    context,
    source,
    configs,
    candidateRecords,
    partyMap,
    partyListRecords,
    concurrency,
  } = options;
  const limit = pLimit(concurrency);

  async function fetchWithPacing(
    context: BrowserContext,
    electorateConfig: ElectorateConfig
  ): Promise<{ html: string; config: ElectorateConfig }> {
    // Gentle pacing between requests (jittered) so bursts don't trip
    // Cloudflare rate limiting mid-cycle.
    await sleep(collectorConfig.fetchPacingMs * (0.5 + Math.random()));
    const startedAt = performance.now();
    try {
      const html = await getElectoratePageHtml(context, electorateConfig);
      return { html, config: electorateConfig };
    } catch (reason) {
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      const detail =
        reason instanceof Error ? reason.message : String(reason);
      log.error(
        `${electorateConfig.electorateName}: fetch failed after ${elapsed}s (${detail})`
      );
      throw reason;
    }
  }

  log.info('Starting election results scraping...');
  const start = performance.now();

  const cachedResults = readResults();
  const cachedByName = new Map(cachedResults.map((r) => [r.electorateName, r]));

  const settled = await Promise.allSettled(
    configs.map((cfg) => limit(() => fetchWithPacing(context, cfg)))
  );

  const failedIndexes: number[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'rejected') failedIndexes.push(i);
  });

  // One retry pass over failures once the browser context is warm (the
  // Cloudflare challenge is solved by then and cf_clearance is in the jar).
  // Skipped entirely when nothing succeeded at all — retrying would just
  // double the burn time while the site is still blocking the IP.
  const retried = new Map<
    number,
    PromiseSettledResult<{ html: string; config: ElectorateConfig }>
  >();
  const anySucceeded = settled.some((s) => s.status === 'fulfilled');
  if (failedIndexes.length > 0 && anySucceeded) {
    log.info(`Retrying ${failedIndexes.length} failed electorates...`);
    const retryResults = await Promise.allSettled(
      failedIndexes.map((i) =>
        limit(() => fetchWithPacing(context, configs[i]))
      )
    );
    failedIndexes.forEach((originalIndex, k) => {
      retried.set(originalIndex, retryResults[k]);
    });
  } else if (failedIndexes.length > 0) {
    log.warn(
      `Skipping retry pass: ${failedIndexes.length} electorates failed and none succeeded (site likely still blocking)`
    );
  }

  const results: ElectorateResults[] = [];
  type ElectorateSource = 'fresh' | 'cached' | 'failed';
  const electorateSources: ElectorateSource[] = [];

  for (let i = 0; i < settled.length; i++) {
    const s = retried.get(i) ?? settled[i];
    const cfg = configs[i];
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
      electorateSources.push('fresh');
    } else {
      const cached = cachedByName.get(cfg.electorateName);
      if (cached) {
        log.warn(
          `${cfg.electorateName}: scrape failed (${s.reason}); using cached result from previous poll`
        );
        results.push(cached);
        electorateSources.push('cached');
      } else {
        log.error(`Failed to scrape electorate`, s.reason);
        electorateSources.push('failed');
      }
    }
  }

  const totalVotes = results.reduce((s, r) => s + (r.votesCounted || 0), 0);
  log.info(
    `Finished with ${results.length}/${configs.length} electorates (total votes counted: ${totalVotes.toLocaleString()})`
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

  const duration = (performance.now() - start) / 1000;
  const freshCount = electorateSources.filter((s) => s === 'fresh').length;
  const status: 'success' | 'partial' | 'error' =
    freshCount === configs.length
      ? 'success'
      : results.length > 0
        ? 'partial'
        : 'error';
  const events = [emitScrapeDuration(duration, status)];
  for (const source of electorateSources) {
    const electorateStatus =
      source === 'fresh' ? 'success' : source === 'failed' ? 'error' : 'cached';
    events.push(emitScrapeElectorate(electorateStatus));
  }
  publishMetrics(events);

  return {
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  };
}
