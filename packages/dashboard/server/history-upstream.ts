/**
 * History source for the dashboard server: the collector's history REST API
 * (`/history/*` on its health port, bearer-token protected — see
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

export type CandidateSnapshot = {
  candidate: string;
  party: string | null;
  votes: number;
  isPredicted: boolean;
};

export type PartyVoteSnapshot = {
  party: string;
  votes: number;
};

export type ElectorateHistoryPoint = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
  votesCounted: number;
  votePctCounted: number;
  leadingCandidate: string | null;
  leadingParty: string | null;
  predictedWinner: number;
  margin: number | null;
  marginPct: number | null;
  marginOfError: number | null;
  candidates: CandidateSnapshot[];
  partyVotes: PartyVoteSnapshot[];
};

export type PartyVoteHistoryPoint = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
  votesCounted: number;
  votePctCounted: number;
  parties: {
    party: string;
    votes: number;
    seats: number;
    electorateSeats: number;
    listSeats: number;
  }[];
};

export type SnapshotMeta = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
};

export interface HistorySource {
  snapshotMetas(): Promise<SnapshotMeta[]>;
  electorateHistory(name: string): Promise<ElectorateHistoryPoint[]>;
  partyVoteHistory(): Promise<PartyVoteHistoryPoint[]>;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export function createHistorySource(options: {
  baseUrl: string;
  token?: string;
  fetchTimeoutMs?: number;
  cacheTtlMs?: number;
}): HistorySource {
  const { baseUrl, token } = options;
  const timeoutMs = options.fetchTimeoutMs ?? 5_000;
  const ttlMs = options.cacheTtlMs ?? 10_000;
  const cache = new Map<string, CacheEntry>();

  async function fetchJson<T>(path: string): Promise<T> {
    const cached = cache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 503) {
      // Collector hasn't created the DB yet — treat as empty, not an error.
      return [] as T;
    }
    if (!res.ok) {
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
  };
}
