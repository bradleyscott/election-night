import pLimit from 'p-limit';
import { config } from '@election-night/core/config';
import type {
  ElectorateConfig,
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
import { emitScrapeDuration, emitScrapeElectorate } from './metrics.js';

export type ScrapeCycleOptions = {
  source: ElectionSource;
  configs: ElectorateConfig[];
  partyListRecords: PartyList[];
  concurrency: number;
  /**
   * The previous snapshot's results. Electorates that fail both the initial
   * fetch and the retry pass fall back to their value here, so a transient
   * failure does not blank an electorate out of the payload.
   */
  fallback?: ElectorateResults[];
  /** Receives metric events; the dashboard server applies them to its registry. */
  onMetrics?: (events: MetricEvent | MetricEvent[]) => void;
};

export type ScrapeCycleResult = {
  payload: ResultsPayload;
  /** Electorates fetched from the feed this cycle. */
  fresh: number;
  /** Electorates served from the previous snapshot after both attempts failed. */
  fallback: number;
  /** Electorates with no result at all (no fetch, no previous snapshot). */
  failed: number;
  total: number;
};

export async function scrapeCycle(
  options: ScrapeCycleOptions
): Promise<ScrapeCycleResult> {
  const { source, configs, partyListRecords, concurrency, fallback, onMetrics } =
    options;
  const limit = pLimit(concurrency);

  type FetchResult = { raw: RawElectorateResults; config: ElectorateConfig };

  async function fetchOne(
    electorateConfig: ElectorateConfig
  ): Promise<FetchResult> {
    const startedAt = performance.now();
    try {
      const raw = await source.fetchResults(electorateConfig);
      return { raw, config: electorateConfig };
    } catch (reason) {
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      const detail = reason instanceof Error ? reason.message : String(reason);
      log.error(
        `${electorateConfig.electorateName}: fetch failed after ${elapsed}s (${detail})`
      );
      throw reason;
    }
  }

  log.info('Fetching election results...');
  const start = performance.now();

  const fallbackByName = new Map(
    (fallback ?? []).map((r) => [r.electorateName, r])
  );

  const settled = await Promise.allSettled(
    configs.map((cfg) => limit(() => fetchOne(cfg)))
  );

  // One retry pass over the failures. Failures are usually correlated (the
  // feed is up or it is not), so a second pass is cheap and usually settles
  // a transient blip.
  const failedIndexes = settled
    .map((s, i) => (s.status === 'rejected' ? i : -1))
    .filter((i) => i >= 0);

  const retried = new Map<number, PromiseSettledResult<FetchResult>>();
  if (failedIndexes.length > 0) {
    log.info(`Retrying ${failedIndexes.length} failed electorates...`);
    const retryResults = await Promise.allSettled(
      failedIndexes.map((i) => limit(() => fetchOne(configs[i]!)))
    );
    failedIndexes.forEach((originalIndex, k) => {
      retried.set(originalIndex, retryResults[k]!);
    });
  }

  const results: ElectorateResults[] = [];
  type ElectorateSource = 'fresh' | 'fallback' | 'failed';
  const electorateSources: ElectorateSource[] = [];

  for (let i = 0; i < settled.length; i++) {
    const s = retried.get(i) ?? settled[i]!;
    const cfg = configs[i]!;

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
      results.push(electorateResults);
      electorateSources.push('fresh');
      continue;
    }

    const previous = fallbackByName.get(cfg.electorateName);
    if (previous) {
      log.warn(
        `${cfg.electorateName}: fetch failed twice; reusing the previous snapshot's result`
      );
      results.push(previous);
      electorateSources.push('fallback');
    } else {
      log.error(`${cfg.electorateName}: no result available`, s.reason);
      electorateSources.push('failed');
    }
  }

  const fresh = electorateSources.filter((s) => s === 'fresh').length;
  const fallbackCount = electorateSources.filter(
    (s) => s === 'fallback'
  ).length;
  const failed = electorateSources.filter((s) => s === 'failed').length;

  const totalVotes = results.reduce((s, r) => s + (r.votesCounted || 0), 0);
  log.info(
    `Finished with ${results.length}/${configs.length} electorates (${fresh} fresh, ${fallbackCount} reused; total votes counted: ${totalVotes.toLocaleString()})`
  );

  const zeroVoteElectorates = results.filter(
    (r) => (r.votesCounted || 0) === 0
  ).length;
  if (zeroVoteElectorates > 0) {
    log.warn(`${zeroVoteElectorates} electorates have 0 votes counted`);
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
  const status: 'success' | 'partial' | 'error' =
    fresh === configs.length ? 'success' : results.length > 0 ? 'partial' : 'error';
  const events: MetricEvent[] = [emitScrapeDuration(duration, status)];
  const metricStatus: Record<ElectorateSource, 'success' | 'error' | 'fallback'> =
    { fresh: 'success', fallback: 'fallback', failed: 'error' };
  for (const electorateSource of electorateSources) {
    events.push(emitScrapeElectorate(metricStatus[electorateSource]));
  }
  onMetrics?.(events);

  return {
    payload: {
      electorateResults: withPredictions,
      partyVote,
      partyLists,
    },
    fresh,
    fallback: fallbackCount,
    failed,
    total: configs.length,
  };
}
