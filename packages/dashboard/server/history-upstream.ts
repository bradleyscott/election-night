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
 */

import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  SnapshotMeta,
} from '@election-night/core/history';

export type { ElectorateHistoryPoint, PartyVoteHistoryPoint, SnapshotMeta };

export interface HistorySource {
  snapshotMetas(): Promise<SnapshotMeta[]>;
  electorateHistory(name: string): Promise<ElectorateHistoryPoint[]>;
  partyVoteHistory(): Promise<PartyVoteHistoryPoint[]>;
  clearCache(): void;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export function createHistorySource(options: {
  baseUrl: string;
  fetchTimeoutMs?: number;
  cacheTtlMs?: number;
}): HistorySource {
  const { baseUrl } = options;
  const timeoutMs = options.fetchTimeoutMs ?? 5_000;
  const ttlMs = options.cacheTtlMs ?? 10_000;
  const cache = new Map<string, CacheEntry>();

  async function fetchJson<T>(path: string): Promise<T> {
    const cached = cache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Collector unreachable: fall back to the stale cached value if we
      // have one — better than a 500 on the Trends page.
      if (cached) return cached.value as T;
      throw new Error(`history upstream ${path} unreachable`);
    }
    if (res.status === 503) {
      // Collector hasn't created the DB yet — treat as empty, not an error.
      return [] as T;
    }
    if (!res.ok) {
      // Proxy-level errors (rate limiting, bad gateway): serve stale if we
      // have it, else surface the failure.
      if (cached) return cached.value as T;
      throw new Error(`history upstream ${path} responded ${res.status}`);
    }
    const value = (await res.json()) as T;
    cache.set(path, { expiresAt: Date.now() + ttlMs, value });
    return value;
  }

  return {
    snapshotMetas: () => fetchJson('/history/snapshots'),
    electorateHistory: (name) =>
      fetchJson(`/history/electorate/${encodeURIComponent(name)}`),
    partyVoteHistory: () => fetchJson('/history/party-votes'),
    clearCache: () => cache.clear(),
  };
}
