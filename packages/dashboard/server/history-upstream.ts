/**
 * History source for the dashboard server: the collector's history REST API
 * (`/history/*` on its health port, unauthenticated — see
 * packages/collector/src/history-server.ts).
 *
 * This is the *only* history source. The server never opens a SQLite DB:
 * the collector owns the DB and the server is a client of it, in every
 * environment (dev, all-in-one Docker, split deployment). For co-located
 * processes the default upstream `http://127.0.0.1:3459` applies.
 *
 * Responses are cached briefly (default 10s) so dashboard traffic bursts
 * (Trends page, /ready) don't hammer the collector on every request.
 *
 * `read()` returns a `HistoryRead`: the parsed value *and* how it was obtained.
 * A cache hit is `cached`; a fresh upstream response is `verified`; a value
 * served after a failed refresh is `stale`. Only a successfully decoded
 * upstream response advances `verifiedAt`, so a stale fallback can never look
 * current merely because someone asked for it again. When the last verified
 * answer is older than `maxStaleMs` (default 120s) the read is `unavailable`
 * and the caller must answer 503 rather than present old data as live.
 *
 * Upstream calls, their latency and cache behaviour are instrumented in
 * `./metrics.ts` — a `stale_served` outcome means the collector was
 * unreachable and a cached value was served instead.
 */

import type {
  ElectorateHistoryPoint,
  LatestStateRow,
  PartyVoteHistoryPoint,
  PriorWinnersResponse,
  ResultsForYear,
  SnapshotMeta,
} from '@election-night/core/history';
import type { VotingPlacesResponse } from '@election-night/core/voting-places';
import {
  historyCacheEvents,
  historyStaleServeAge,
  historyUpstreamDuration,
  historyUpstreamTotal,
  historyVerificationFailuresTotal,
} from './metrics.js';

export type {
  ElectorateHistoryPoint,
  LatestStateRow,
  PartyVoteHistoryPoint,
  PriorWinnersResponse,
  ResultsForYear,
  SnapshotMeta,
};

/** How a history value was obtained. */
export type HistoryState = 'verified' | 'cached' | 'stale';

function readRevision(headers: Headers): number | null {
  const raw =
    headers.get('x-election-revision') ?? headers.get('x-history-revision');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Why a read could not be verified. A closed set, used as a metric label and
 * as the `X-Election-History-Reason` response header.
 */
export type HistoryFailureReason =
  | 'upstream-unreachable'
  | 'upstream-unavailable'
  | 'upstream-error'
  | 'invalid-response'
  | 'stale-too-old';

export interface HistoryRead<T> {
  /** Parsed upstream value, or null when the resource is legitimately absent. */
  data: T | null;
  state: HistoryState;
  /** Epoch ms of the last successful upstream verification, null if never. */
  verifiedAt: number | null;
  /** Bounded reason when the read is degraded. */
  reason?: HistoryFailureReason;
  /** Committed revision the body belongs to, when the collector named one. */
  revision?: number | null;
  /**
   * True when no usable answer may be served: the upstream failed and there is
   * either no cached value or the last verification is past `maxStaleMs`.
   * A legitimately absent resource is *not* unavailable — it is a verified
   * "not found".
   */
  unavailable: boolean;
}

export interface HistorySource {
  snapshotMetas(): Promise<HistoryRead<SnapshotMeta[]>>;
  /** The authoritative latest payload and revision, or a verified absence. */
  latest(): Promise<HistoryRead<LatestStateRow>>;
  electorateHistory(
    name: string
  ): Promise<HistoryRead<ElectorateHistoryPoint[]>>;
  partyVoteHistory(): Promise<HistoryRead<PartyVoteHistoryPoint[]>>;
  /** Winners of every prior cycle the collector could derive, matched to the current cycle. */
  priorWinners(): Promise<HistoryRead<PriorWinnersResponse>>;
  /** Results for a nominated year, or null when that year cannot be served. */
  resultsForYear(year: string): Promise<HistoryRead<ResultsForYear>>;
  /**
   * Which voting places count towards a seat and which have reported, or null
   * when the collector cannot answer for this cycle (an archived cycle, whose
   * feed forbids directory listing).
   */
  votingPlaces(name: string): Promise<HistoryRead<VotingPlacesResponse>>;
  clearCache(): void;
}

interface CacheEntry {
  value: unknown;
  /** Epoch ms of the successful upstream response that produced `value`. */
  verifiedAt: number;
  expiresAt: number;
  /** Committed revision the cached body belongs to, when known. */
  revision: number | null;
}

export const DEFAULT_MAX_STALE_MS = 120_000;

export function createHistorySource(options: {
  baseUrl: string;
  fetchTimeoutMs?: number;
  cacheTtlMs?: number;
  /** How old a cached value may be and still be served after a failed refresh. */
  maxStaleMs?: number;
  /** Injected clock for tests. */
  now?: () => number;
}): HistorySource {
  const { baseUrl } = options;
  const timeoutMs = options.fetchTimeoutMs ?? 5_000;
  const ttlMs = options.cacheTtlMs ?? 10_000;
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<HistoryRead<unknown>>>();

  function verified<T>(
    value: T,
    at: number,
    revision: number | null
  ): HistoryRead<T> {
    return {
      data: value,
      state: 'verified',
      verifiedAt: at,
      revision,
      unavailable: false,
    };
  }

  /**
   * A verified "this resource does not exist" answer. It is deliberately not
   * cached: the collector retries an unavailable archive year in its loop, so a
   * cached miss would pin the UI to an empty state.
   */
  function missing<T>(revision: number | null = null): HistoryRead<T> {
    return {
      data: null,
      state: 'verified',
      verifiedAt: now(),
      revision,
      unavailable: false,
    };
  }

  /**
   * The fallback after a failed refresh: serve the last verified value while it
   * is young enough, otherwise report that nothing usable is available.
   */
  function degraded<T>(
    path: string,
    route: string,
    reason: HistoryFailureReason
  ): HistoryRead<T> {
    const cached = cache.get(path);
    historyVerificationFailuresTotal.inc({ route, reason });

    if (!cached) {
      return {
        data: null,
        state: 'stale',
        verifiedAt: null,
        revision: null,
        reason,
        unavailable: true,
      };
    }

    const ageMs = Math.max(0, now() - cached.verifiedAt);
    if (ageMs > maxStaleMs) {
      return {
        data: null,
        state: 'stale',
        verifiedAt: cached.verifiedAt,
        revision: cached.revision,
        reason: 'stale-too-old',
        unavailable: true,
      };
    }

    historyCacheEvents.inc({ result: 'stale' });
    historyStaleServeAge.observe({ route }, ageMs / 1000);
    return {
      data: cached.value as T,
      state: 'stale',
      verifiedAt: cached.verifiedAt,
      revision: cached.revision,
      reason,
      unavailable: false,
    };
  }

  async function refresh<T>(
    path: string,
    route: string,
    allowMissing: boolean
  ): Promise<HistoryRead<T>> {
    const startedAt = performance.now();
    const observeDuration = () =>
      historyUpstreamDuration.observe(
        { route },
        (performance.now() - startedAt) / 1000
      );

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      observeDuration();
      historyUpstreamTotal.inc({
        route,
        outcome: cache.has(path) ? 'stale_served' : 'error',
      });
      return degraded<T>(path, route, 'upstream-unreachable');
    }
    observeDuration();

    const revision = readRevision(res.headers);
    if (res.status === 404 && allowMissing) {
      // Consume the body so the keep-alive socket is released.
      await res.text().catch(() => undefined);
      historyUpstreamTotal.inc({ route, outcome: 'ok' });
      return missing<T>(revision);
    }

    if (!res.ok) {
      await res.text().catch(() => undefined);
      // A collector 503 means "not available yet", never "empty and successful".
      const reason: HistoryFailureReason =
        res.status === 503 ? 'upstream-unavailable' : 'upstream-error';
      historyUpstreamTotal.inc({
        route,
        outcome: cache.has(path) ? 'stale_served' : 'error',
      });
      return degraded<T>(path, route, reason);
    }

    let value: T;
    try {
      value = (await res.json()) as T;
    } catch {
      historyUpstreamTotal.inc({ route, outcome: 'error' });
      return degraded<T>(path, route, 'invalid-response');
    }

    const at = now();
    historyUpstreamTotal.inc({ route, outcome: 'ok' });
    cache.set(path, { value, verifiedAt: at, expiresAt: at + ttlMs, revision });
    return verified(value, at, revision);
  }

  async function read<T>(
    path: string,
    route: string,
    options: { allowMissing?: boolean } = {}
  ): Promise<HistoryRead<T>> {
    const at = now();
    const cached = cache.get(path);
    if (cached && cached.expiresAt > at) {
      historyCacheEvents.inc({ result: 'hit' });
      return {
        data: cached.value as T,
        state: 'cached',
        verifiedAt: cached.verifiedAt,
        revision: cached.revision,
        unavailable: false,
      };
    }
    historyCacheEvents.inc({ result: 'miss' });

    // Share one refresh between concurrent callers. The entry is removed in
    // `finally`, so a failed refresh is retried by the next caller rather than
    // being remembered as a failure.
    const existing = inFlight.get(path);
    if (existing) return existing as Promise<HistoryRead<T>>;

    const promise = refresh<T>(
      path,
      route,
      options.allowMissing ?? false
    ).finally(() => {
      if (inFlight.get(path) === promise) inFlight.delete(path);
    });
    inFlight.set(path, promise);
    return promise;
  }

  return {
    snapshotMetas: () =>
      read<SnapshotMeta[]>('/history/snapshots', '/history/snapshots'),
    latest: () =>
      read<LatestStateRow>('/history/latest', '/history/latest', {
        allowMissing: true,
      }),
    electorateHistory: (name) =>
      read<ElectorateHistoryPoint[]>(
        `/history/electorate/${encodeURIComponent(name)}`,
        '/history/electorate/:name'
      ),
    partyVoteHistory: () =>
      read<PartyVoteHistoryPoint[]>(
        '/history/party-votes',
        '/history/party-votes'
      ),
    priorWinners: () =>
      read<PriorWinnersResponse>(
        '/history/prior-winners',
        '/history/prior-winners'
      ),
    resultsForYear: (year) =>
      read<ResultsForYear>(
        `/history/results/${year}`,
        '/history/results/:year',
        {
          allowMissing: true,
        }
      ),
    votingPlaces: (name) =>
      read<VotingPlacesResponse>(
        `/history/voting-places/${encodeURIComponent(name)}`,
        '/history/voting-places/:name',
        { allowMissing: true }
      ),
    clearCache: () => cache.clear(),
  };
}
