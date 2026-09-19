import pLimit from 'p-limit';
import { config } from '@election-night/core/config';
import type {
  ElectorateConfig,
  ElectorateFetchErrorReason,
  ElectorateResults,
  ElectionSource,
  MetricEvent,
  PartyList,
  RawElectorateResults,
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
import { sleep } from './util.js';
import { collectorConfig } from './config.js';
import { publishMetrics } from './ws-client.js';
import { readResults } from './results.js';
import {
  emitElectorateFetchDuration,
  emitElectorateFetchError,
  emitScrapeDuration,
  emitScrapeElectorate,
  emitScrapeRetries,
  emitVotesCounted,
} from './metrics.js';

export type ScrapeCycleOptions = {
  source: ElectionSource;
  configs: ElectorateConfig[];
  partyListRecords: PartyList[];
  concurrency: number;
};

/**
 * Bucket a fetch failure into the bounded `reason` label. Messages come from
 * `fetch` (network), the XML source (HTTP status / parse) or AbortSignal
 * (timeout), so match on all three rather than trusting a single error type.
 */
export function classifyFetchError(
  reason: unknown
): ElectorateFetchErrorReason {
  const name = reason instanceof Error ? reason.name : '';
  const message = reason instanceof Error ? reason.message : String(reason);
  const lower = message.toLowerCase();

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  ) {
    return 'timeout';
  }
  if (/\b[45]\d\d\b/.test(message) || lower.includes('http')) {
    return 'http';
  }
  if (
    name === 'SyntaxError' ||
    lower.includes('parse') ||
    lower.includes('xml') ||
    lower.includes('unexpected token')
  ) {
    return 'parse';
  }
  return 'network';
}

export async function scrapeCycle(
  options: ScrapeCycleOptions
): Promise<ResultsPayload> {
  const { source, configs, partyListRecords, concurrency } = options;
  const limit = pLimit(concurrency);

  // Metrics for work that happens inside the fetch stage, collected here and
  // published with the rest of the cycle's events.
  const cycleEvents: MetricEvent[] = [];

  async function fetchWithPacing(
    electorateConfig: ElectorateConfig
  ): Promise<{ raw: RawElectorateResults; config: ElectorateConfig }> {
    // Gentle pacing between requests (jittered) so bursts don't trip
    // rate limiting mid-cycle.
    await sleep(collectorConfig.fetchPacingMs * (0.5 + Math.random()));
    const startedAt = performance.now();
    try {
      const raw = await source.fetchResults(electorateConfig);
      cycleEvents.push(
        emitElectorateFetchDuration(
          (performance.now() - startedAt) / 1000,
          'success'
        )
      );
      return { raw, config: electorateConfig };
    } catch (reason) {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      cycleEvents.push(emitElectorateFetchDuration(elapsedSeconds, 'error'));
      cycleEvents.push(emitElectorateFetchError(classifyFetchError(reason)));
      const detail = reason instanceof Error ? reason.message : String(reason);
      log.error(
        `${electorateConfig.electorateName}: fetch failed after ${elapsedSeconds.toFixed(1)}s (${detail})`
      );
      throw reason;
    }
  }

  log.info('Starting election results scraping...');
  const start = performance.now();

  const cachedResults = readResults();
  const cachedByName = new Map(cachedResults.map((r) => [r.electorateName, r]));

  const settled = await Promise.allSettled(
    configs.map((cfg) => limit(() => fetchWithPacing(cfg)))
  );

  const failedIndexes: number[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'rejected') failedIndexes.push(i);
  });

  // One retry pass over failures. Skipped entirely when nothing succeeded at
  // all — retrying would just double the burn time while the feed is down.
  type FetchResult = { raw: RawElectorateResults; config: ElectorateConfig };
  const retried = new Map<number, PromiseSettledResult<FetchResult>>();
  const anySucceeded = settled.some((s) => s.status === 'fulfilled');
  if (failedIndexes.length > 0 && anySucceeded) {
    log.info(`Retrying ${failedIndexes.length} failed electorates...`);
    const retryResults = await Promise.allSettled(
      failedIndexes.map((i) => limit(() => fetchWithPacing(configs[i])))
    );
    failedIndexes.forEach((originalIndex, k) => {
      retried.set(originalIndex, retryResults[k]);
    });
  } else if (failedIndexes.length > 0) {
    log.warn(
      `Skipping retry pass: ${failedIndexes.length} electorates failed and none succeeded (site likely still blocking)`
    );
  }
  cycleEvents.push(
    emitScrapeRetries(
      failedIndexes.length > 0 && anySucceeded ? failedIndexes.length : 0
    )
  );

  const results: ElectorateResults[] = [];
  type ElectorateSource = 'fresh' | 'cached' | 'failed';
  const electorateSources: ElectorateSource[] = [];

  for (let i = 0; i < settled.length; i++) {
    const s = retried.get(i) ?? settled[i];
    const cfg = configs[i];
    if (s.status === 'fulfilled') {
      const raw = s.value.raw;
      const electorateResults: ElectorateResults = {
        electorateName: raw.electorateName,
        partyVotes: raw.partyVotes,
        candidateVotes: raw.candidateVotes,
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
    .map((x) => calculateLead({ ...x, candidateVotes: [...x.candidateVotes] }))
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
  const reporting = results.filter((r) => (r.votesCounted || 0) > 0).length;
  const events: MetricEvent[] = [
    emitScrapeDuration(duration, status),
    emitVotesCounted(totalVotes, reporting, configs.length),
    ...cycleEvents,
  ];
  for (const electorateSource of electorateSources) {
    const electorateStatus =
      electorateSource === 'fresh'
        ? 'success'
        : electorateSource === 'failed'
          ? 'error'
          : 'cached';
    events.push(emitScrapeElectorate(electorateStatus));
  }
  publishMetrics(events);

  return {
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  };
}
