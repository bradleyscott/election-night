import { createHash, randomUUID } from 'node:crypto';
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
   * `Last-Modified` per electorate from the previous cycle. When a seat has one
   * the fetch asks `If-Modified-Since` and reuses the cached result on a 304;
   * with no stamp — a first cycle, a restart, a seat that never answered — the
   * seat is downloaded unconditionally.
   */
  previousStamps?: ReadonlyMap<string, string>;
};

/** How the cycle covered each electorate. */
export type ScrapeCycleCounts = {
  /** Seats that returned a body this cycle. */
  fresh: number;
  /** Seats the feed confirmed unchanged with a 304. */
  unchanged: number;
  /** Seats that failed but had a cached result to fall back on. */
  cached: number;
  /** Seats with no result at all this cycle. */
  failed: number;
};

/**
 * What one cycle produced.
 *
 * `signature` is the answer to "would publishing this change anything?": a
 * digest of the counted facts in the payload, not of the transport. Comparing
 * it against the signature of the last *successfully published* payload makes
 * "changed" exact — a seat republished with identical content does not count,
 * a seat whose body changed without a moving `Last-Modified` does, and a failed
 * write is retried on the next cycle because the signature was never stored.
 */
export type ScrapeCycleResult = {
  payload: ResultsPayload;
  /** `Last-Modified` per electorate, carried forward for seats that 304'd. */
  stamps: Map<string, string>;
  /** Digest of the counted facts in `payload`; see `payloadSignature`. */
  signature: string;
  /**
   * Stable idempotency key for this result. A commit retry reuses it so the
   * same publication cannot insert a second snapshot; a new cycle (including
   * a correction back to an earlier value) gets a new key and revision.
   */
  publicationKey: string;
  counts: ScrapeCycleCounts;
};

/**
 * A stable digest of the facts a publish would carry.
 *
 * Built from an explicit projection rather than `JSON.stringify(payload)` so
 * the key cannot depend on property order or on fields that change without the
 * count changing (`updatedAt`, derived leaders, percentages). Both the live
 * cycle and the cached result it reuses from a 304 go through the same
 * projection, so an unchanged seat hashes the same either way.
 */
export function payloadSignature(payload: ResultsPayload): string {
  const facts = {
    electorates: payload.electorateResults.map((r) => [
      r.electorateName,
      r.votesCounted ?? 0,
      r.votePercentageCounted ?? 0,
      r.percentVotesCast ?? 0,
      r.candidateVotes.map((v) => [v.candidate, v.party ?? '', v.votes]),
      r.partyVotes.map((v) => [v.candidate, v.votes]),
    ]),
    parties: payload.partyVote.map((p) => [p.candidate, p.votes, p.seats]),
    lists: payload.partyLists.map((p) => [
      p.party,
      p.listRank,
      p.adjustedRank,
      p.distanceFromCut,
    ]),
  };
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

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
    ifModifiedSince: string | undefined,
    hasCachedResult: boolean
  ): Promise<FetchOutcome> {
    // Gentle pacing between requests (jittered) so bursts don't trip
    // rate limiting mid-cycle.
    await sleep(collectorConfig.fetchPacingMs * (0.5 + Math.random()));
    const startedAt = performance.now();
    try {
      let outcome: FetchOutcome;
      if (typeof source.fetchResultsConditional === 'function') {
        let answer = await source.fetchResultsConditional(
          electorateConfig,
          ifModifiedSince
        );
        // A 304 for a seat we hold no body for describes data we have never
        // seen. Ask again without the header instead of leaving the seat out of
        // the payload: publishing a payload with an electorate missing would
        // take it off every page and record the drop in history.
        if (
          answer.status === 'not-modified' &&
          ifModifiedSince &&
          !hasCachedResult
        ) {
          log.warn(
            `${electorateConfig.electorateName}: feed answered not-modified but no cached result exists; refetching unconditionally`
          );
          answer = await source.fetchResultsConditional(electorateConfig);
        }
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
          // A 304 is a healthy answer with a ten-times-shorter latency; mixing
          // the two under one histogram label makes the per-fetch p95 lie.
          outcome.kind === 'unchanged' ? 'unchanged' : 'success'
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
    fetchWithPacing(
      cfg,
      previousStamps.get(cfg.electorateName),
      cachedByName.has(cfg.electorateName)
    )
  );

  const failedIndexes: number[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'rejected') failedIndexes.push(i);
  });

  // One retry pass over failures. Skipped entirely when nothing succeeded at
  // all — retrying would just double the burn time while the feed is down.
  // Retries go out without a conditional header: a seat that failed has no
  // answer to reuse, and another 304 would leave it with nothing to show.
  const retried = new Map<number, Settled<FetchOutcome>>();
  const anySucceeded = settled.some((s) => s.status === 'fulfilled');
  if (failedIndexes.length > 0 && anySucceeded) {
    log.info(`Retrying ${failedIndexes.length} failed electorates...`);
    const retryResults = await mapSettledWithConcurrency(
      failedIndexes.map((i) => configs[i]),
      concurrency,
      (cfg) => fetchWithPacing(cfg, undefined, true)
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
  // Seats that left the cycle are dropped, so a redrawn electorate list cannot
  // leave a stamp waiting for a seat that is no longer fetched.
  const wanted = new Set(configs.map((c) => c.electorateName));
  const stamps = new Map(
    [...previousStamps].filter(([name]) => wanted.has(name))
  );

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
          // A copy, because the stamp below is written onto the result: the
          // cached object is also what the results cache and the live results
          // service hold, and mutating it would restamp published data.
          results.push({ ...cached });
          electorateSources.push('unchanged');
        } else {
          // `fetchWithPacing` already re-asks when it sees this, so reaching
          // here means the source answered 304 twice. Drop the stamp so the
          // next cycle fetches the seat unconditionally; keeping it would pin
          // the hole forever.
          stamps.delete(cfg.electorateName);
          log.warn(
            `${cfg.electorateName}: feed answered not-modified twice with no cached result exists; refetching unconditionally next cycle`
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
      results.push({ ...electorateResults });
      electorateSources.push('fresh');
    } else {
      const cached = cachedByName.get(cfg.electorateName);
      if (cached) {
        log.warn(
          `${cfg.electorateName}: scrape failed (${s.reason}); using cached result from previous poll`
        );
        results.push({ ...cached });
        electorateSources.push('cached');
      } else {
        log.error(`Failed to scrape electorate`, s.reason);
        electorateSources.push('failed');
      }
    }
  }

  // Each seat carries when the Commission last republished it, so the page can
  // say how old *this seat's* count is instead of when this browser last
  // received a payload from a feed where most seats had not moved. A seat that
  // answered 304 carries the stamp forward with it. A source that cannot stamp
  // (a custom adapter, an archived cycle) clears the field rather than leaving
  // a date from whenever this seat last had one.
  for (const r of results) {
    const stamp = stamps.get(r.electorateName);
    const published = stamp ? new Date(stamp) : null;
    if (published && !Number.isNaN(published.getTime())) {
      r.updatedAt = published.toISOString();
    } else {
      delete r.updatedAt;
    }
  }

  const counts: ScrapeCycleCounts = {
    fresh: electorateSources.filter((s) => s === 'fresh').length,
    unchanged: electorateSources.filter((s) => s === 'unchanged').length,
    cached: electorateSources.filter((s) => s === 'cached').length,
    failed: electorateSources.filter((s) => s === 'failed').length,
  };

  const totalVotes = results.reduce((s, r) => s + (r.votesCounted || 0), 0);
  log.info(
    `Finished with ${results.length}/${configs.length} electorates (fresh ${counts.fresh}, unchanged ${counts.unchanged}, cached ${counts.cached}, failed ${counts.failed}; total votes counted: ${totalVotes.toLocaleString()})`
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
  // An unchanged seat is a healthy answer, not a partial scrape: the cycle
  // covered every electorate either way.
  const status: 'success' | 'partial' | 'error' =
    counts.fresh + counts.unchanged === configs.length
      ? 'success'
      : results.length > 0
        ? 'partial'
        : 'error';
  // What the cycle spent its time on, which is not the same question as whether
  // it succeeded: once most polls are 304s, a blended cycle-duration p95 is an
  // average of two unrelated measurements. `degraded` is deliberately not
  // `quiet` — a cycle where a seat failed also transferred nothing, and calling
  // that quiet is how an outage hides inside a healthy-looking baseline.
  const mode: 'reading' | 'quiet' | 'degraded' =
    counts.fresh > 0
      ? 'reading'
      : counts.unchanged === configs.length
        ? 'quiet'
        : 'degraded';
  const reporting = results.filter((r) => (r.votesCounted || 0) > 0).length;
  const events: MetricEvent[] = [
    emitScrapeDuration(duration, status, mode),
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

  const payload = {
    electorateResults: withPredictions,
    partyVote,
    partyLists,
  };

  return {
    payload,
    stamps,
    signature: payloadSignature(payload),
    publicationKey: randomUUID(),
    counts,
  };
}
