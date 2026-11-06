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
import { buildResultsPayload } from '@election-night/core/reducers';
import {
  mapSettledWithConcurrency,
  type Settled,
} from '@election-night/core/concurrency';
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
  /**
   * Ask each seat whether it changed since `previousStamps` and reuse the
   * cached result when the feed answers `304 Not Modified`. Off (the default)
   * re-downloads every seat, which is what an unconditional sweep does.
   */
  conditional?: boolean;
  /** `Last-Modified` per electorate from the previous cycle. */
  previousStamps?: ReadonlyMap<string, string>;
};

/**
 * What one cycle produced.
 *
 * `advanced` is the transport-independent answer to "did anything change?": it
 * compares the stamps the feed returned against the ones the previous cycle
 * held, so a full sweep — where every file comes back 200 even when its content
 * is identical — is not mistaken for a change.
 */
export type ScrapeCycleResult = {
  payload: ResultsPayload;
  /** `Last-Modified` per electorate, carried forward for seats that 304'd. */
  stamps: Map<string, string>;
  /** True when at least one seat's stamp differs from the previous cycle's. */
  advanced: boolean;
  /** Seats that returned a body this cycle (the rest were 304 or failed). */
  refreshed: number;
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
  return (await scrapeCycleWithMeta(options)).payload;
}

export async function scrapeCycleWithMeta(
  options: ScrapeCycleOptions
): Promise<ScrapeCycleResult> {
  const { source, configs, partyListRecords, concurrency } = options;
  const previousStamps = options.previousStamps ?? new Map<string, string>();

  // Metrics for work that happens inside the fetch stage, collected here and
  // published with the rest of the cycle's events.
  const cycleEvents: MetricEvent[] = [];

  type FetchOutcome =
    | { kind: 'fresh'; raw: RawElectorateResults; lastModified: string | null }
    | { kind: 'unchanged'; lastModified: string | null };

  async function fetchWithPacing(
    electorateConfig: ElectorateConfig,
    useConditional: boolean
  ): Promise<FetchOutcome> {
    // Gentle pacing between requests (jittered) so bursts don't trip
    // rate limiting mid-cycle.
    await sleep(collectorConfig.fetchPacingMs * (0.5 + Math.random()));
    const startedAt = performance.now();
    const since = useConditional
      ? previousStamps.get(electorateConfig.electorateName)
      : undefined;
    try {
      let outcome: FetchOutcome;
      // A sweep still goes through the meta fetch: "unconditional" means "send
      // no If-Modified-Since", not "throw the stamp away". Without that, a
      // sweep would leave the collector with no stamps and no way to start
      // asking cheaply again.
      if (typeof source.fetchResultsConditional === 'function') {
        const answer = await source.fetchResultsConditional(
          electorateConfig,
          since
        );
        outcome =
          answer.status === 'not-modified'
            ? { kind: 'unchanged', lastModified: answer.lastModified }
            : {
                kind: 'fresh',
                raw: answer.results,
                lastModified: answer.lastModified,
              };
      } else {
        const raw = await source.fetchResults(electorateConfig);
        outcome = { kind: 'fresh', raw, lastModified: null };
      }
      cycleEvents.push(
        emitElectorateFetchDuration(
          (performance.now() - startedAt) / 1000,
          'success'
        )
      );
      return outcome;
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

  const settled = await mapSettledWithConcurrency(configs, concurrency, (cfg) =>
    fetchWithPacing(cfg, options.conditional === true)
  );

  const failedIndexes: number[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'rejected') failedIndexes.push(i);
  });

  // One retry pass over failures. Skipped entirely when nothing succeeded at
  // all — retrying would just double the burn time while the feed is down.
  // Retries go out unconditionally: a seat that failed has no answer, and a
  // 304 would leave it with nothing to show.
  const retried = new Map<number, Settled<FetchOutcome>>();
  const anySucceeded = settled.some((s) => s.status === 'fulfilled');
  if (failedIndexes.length > 0 && anySucceeded) {
    log.info(`Retrying ${failedIndexes.length} failed electorates...`);
    const retryResults = await mapSettledWithConcurrency(
      failedIndexes.map((i) => configs[i]),
      concurrency,
      (cfg) => fetchWithPacing(cfg, false)
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
  type ElectorateSource = 'fresh' | 'unchanged' | 'cached' | 'failed';
  const electorateSources: ElectorateSource[] = [];

  // Stamps carry forward rather than being rebuilt each cycle: a seat that
  // answered 304, or failed, keeps the stamp the previous cycle held, so one
  // bad cycle cannot forget what we know and re-download a seat for nothing.
  const stamps = new Map(previousStamps);

  for (let i = 0; i < settled.length; i++) {
    const s = retried.get(i) ?? settled[i];
    const cfg = configs[i];
    if (s.status === 'fulfilled') {
      const outcome = s.value;
      if (outcome.lastModified) {
        stamps.set(cfg.electorateName, outcome.lastModified);
      }

      if (outcome.kind === 'unchanged') {
        const cached = cachedByName.get(cfg.electorateName);
        if (cached) {
          results.push(cached);
          electorateSources.push('unchanged');
        } else {
          // A 304 with nothing cached is a contradiction — a stamp describing
          // data we have never seen. Drop the stamp so the next cycle fetches
          // the seat unconditionally; keeping it would pin the hole forever.
          stamps.delete(cfg.electorateName);
          log.warn(
            `${cfg.electorateName}: feed answered not-modified but no cached result exists; refetching unconditionally next cycle`
          );
          electorateSources.push('failed');
        }
        continue;
      }

      const electorateResults = outcome.raw;
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

  // The Commission's own seat table, re-read every cycle: seats move as counts
  // land, so this is deliberately not part of the memoized reference data.
  const nationalStatus = await source.loadNationalStatus();
  const {
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  } = buildResultsPayload(results, partyListRecords, nationalStatus);

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
  const unchangedCount = electorateSources.filter(
    (s) => s === 'unchanged'
  ).length;
  // An unchanged seat is a healthy answer, not a partial scrape: the cycle
  // covered every electorate either way.
  const status: 'success' | 'partial' | 'error' =
    freshCount + unchangedCount === configs.length
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
        : electorateSource === 'unchanged'
          ? 'unchanged'
          : electorateSource === 'failed'
            ? 'error'
            : 'cached';
    events.push(emitScrapeElectorate(electorateStatus));
  }
  publishMetrics(events);

  // A cycle that starts from no stamps at all is an advance in itself: the
  // payload went from "nothing known" to a full set of seats, and downstream
  // (dashboard preload, webhook baseline) needs it published once.
  const advanced =
    previousStamps.size === 0
      ? results.length > 0
      : [...stamps].some(
          ([name, stamp]) => previousStamps.get(name) !== stamp
        );

  return {
    payload: {
      electorateResults: withPredictions,
      partyVote,
      partyLists,
    },
    stamps,
    advanced,
    refreshed: freshCount,
  };
}
