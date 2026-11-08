/**
 * The browser's history transport and query hooks.
 *
 * One place owns four policies that used to be spread across `useApi`:
 *
 * - **Deadline.** The body, not just the headers, must arrive within 8s. A
 *   proxy that accepts the connection and then stalls cannot hold a chart open.
 * - **Freshness.** The collector/proxy sends `X-Election-History-State`,
 *   `X-Election-History-Verified-At` and `X-Election-History-Reason`. A stale
 *   answer is data with a warning, not a successful current answer.
 * - **Paging.** A response carries `X-History-Total/Limit/Offset`. If the first
 *   body is shorter than the total (or the server refuses an over-cap unpaged
 *   window with 413), the remaining pages are fetched and merged by stable
 *   snapshot id before the chart sees anything.
 * - **Keys.** Every key includes the election cycle, resource and seat, so a
 *   visitor who switches seats can never see the previous seat's rows beneath
 *   the new name.
 */

import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketProvider.js';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig.js';
import {
  HISTORY_POLL_MS,
  HISTORY_REQUEST_TIMEOUT_MS,
  HISTORY_STALE_TIME_MS,
} from './query-client.js';

export type HistoryLoadState =
  'loading' | 'ready' | 'empty' | 'stale' | 'unavailable' | 'error';

export type HistoryMeta = {
  state: 'verified' | 'cached' | 'stale';
  verifiedAt: string | null;
  reason: string | null;
  /** Committed revision the body belongs to, when the proxy named one. */
  revision: number | null;
} | null;

/** A non-2xx history response. `status` drives the honest UI state. */
export class HistoryHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'HistoryHttpError';
    this.status = status;
    this.body = body;
  }
}

export type HistoryRow = { snapshotId: number; startedAt: string };

function readMeta(headers: Headers): HistoryMeta {
  const state = headers.get('x-election-history-state');
  if (state !== 'verified' && state !== 'cached' && state !== 'stale') {
    return null;
  }
  const rawRevision = headers.get('x-election-revision');
  const revision =
    rawRevision !== null && Number.isFinite(Number(rawRevision))
      ? Number(rawRevision)
      : null;
  return {
    state,
    verifiedAt: headers.get('x-election-history-verified-at'),
    reason: headers.get('x-election-history-reason'),
    revision,
  };
}

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * One request with a deadline covering the body read. Returns the parsed body,
 * the freshness metadata and the headers (the paging totals live there).
 */
export async function fetchJsonWithMeta<T>(
  url: string,
  signal?: AbortSignal
): Promise<{ data: T; meta: HistoryMeta; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('history request timed out')),
    HISTORY_REQUEST_TIMEOUT_MS
  );
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    // Read the body inside the deadline: a response whose headers arrived but
    // whose body never completes is still a failed request.
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new HistoryHttpError(res.status, 'History response was not JSON');
      }
    }
    if (!res.ok) {
      throw new HistoryHttpError(res.status, `HTTP ${res.status}`, body);
    }
    return {
      data: body as T,
      meta: readMeta(res.headers),
      headers: res.headers,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function pageUrl(url: string, limit: number, offset: number): string {
  const [base, query] = url.split('?');
  const params = new URLSearchParams(query ?? '');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return `${base}?${params.toString()}`;
}

function mergeRows<T extends HistoryRow>(rows: T[]): T[] {
  const bySnapshot = new Map<number, T>();
  for (const row of rows) bySnapshot.set(row.snapshotId, row);
  return [...bySnapshot.values()].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt)
  );
}

async function fetchPages<T extends HistoryRow>(
  url: string,
  startOffset: number,
  total: number,
  limit: number,
  signal?: AbortSignal
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = startOffset; offset < total; offset += limit) {
    const page = await fetchJsonWithMeta<T[]>(
      pageUrl(url, limit, offset),
      signal
    );
    rows.push(...page.data);
  }
  return rows;
}

/**
 * Fetch a history collection, following the collector's paging metadata when
 * the window is larger than one response. A 413 is the explicit "page me"
 * answer the collector gives instead of truncating; it is handled here rather
 * than shown to the reader as an error.
 */
export async function fetchHistoryCollection<T extends HistoryRow>(
  url: string,
  signal?: AbortSignal
): Promise<{ rows: T[]; meta: HistoryMeta }> {
  try {
    const first = await fetchJsonWithMeta<T[]>(url, signal);
    const total = numberHeader(first.headers, 'x-history-total');
    if (total !== null && total > first.data.length) {
      const limit =
        numberHeader(first.headers, 'x-history-limit') ??
        Math.max(first.data.length, 1);
      const rest = await fetchPages<T>(
        url,
        first.data.length,
        total,
        limit,
        signal
      );
      return {
        rows: mergeRows([...first.data, ...rest]),
        meta: first.meta,
      };
    }
    return { rows: first.data, meta: first.meta };
  } catch (err) {
    if (err instanceof HistoryHttpError && err.status === 413) {
      const body = err.body as { total?: unknown; limit?: unknown } | null;
      const total = typeof body?.total === 'number' ? body.total : 0;
      const limit =
        typeof body?.limit === 'number' && body.limit > 0 ? body.limit : 2_000;
      if (total > 0) {
        const rows = await fetchPages<T>(url, 0, total, limit, signal);
        return { rows: mergeRows(rows), meta: null };
      }
    }
    throw err;
  }
}

function errorState(error: unknown): HistoryLoadState {
  if (
    error instanceof HistoryHttpError &&
    (error.status === 503 || error.status === 404)
  ) {
    return 'unavailable';
  }
  return 'error';
}

function derive<T>(
  query: UseQueryResult<{ rows: T[]; meta: HistoryMeta }>,
  targetRevision: number | null = null
): {
  data: T[] | null;
  state: HistoryLoadState;
  meta: HistoryMeta;
  loading: boolean;
  error: string | null;
  isFetching: boolean;
  refetch: () => void;
} {
  const data = query.data?.rows ?? null;
  const servedRevision = query.data?.meta?.revision ?? null;
  // A response that predates the notification this page has already seen is
  // not caught up, even if the proxy called it verified. The next poll retries.
  const behind =
    targetRevision !== null &&
    servedRevision !== null &&
    servedRevision < targetRevision;
  let state: HistoryLoadState;
  if (data === null) {
    state = query.isError ? errorState(query.error) : 'loading';
  } else if (query.isError || query.data?.meta?.state === 'stale' || behind) {
    // Keep the rows on screen; the reader is told they are not current.
    state = 'stale';
  } else if (data.length === 0) {
    state = 'empty';
  } else {
    state = 'ready';
  }

  return {
    data,
    state,
    meta: query.data?.meta ?? null,
    loading: query.isPending && data === null,
    error: query.error instanceof Error ? query.error.message : null,
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * A paged history collection keyed by cycle/resource/seat. The query waits for
 * `/api/config` so the first request already carries the right cycle, rather
 * than fetching once under a placeholder key and again when the cycle arrives.
 */
export function useHistoryCollection<T extends HistoryRow>(
  key: readonly unknown[],
  url: string | null,
  enabled = true
) {
  const config = useRuntimeConfig();
  const { resultsRevision } = useSocket();
  const cycle = config?.electionYear ?? null;

  const query = useQuery({
    queryKey: [...key, cycle],
    queryFn: ({ signal }) => fetchHistoryCollection<T>(url!, signal),
    enabled: enabled && !!url && !!cycle,
    staleTime: HISTORY_STALE_TIME_MS,
    refetchInterval: HISTORY_POLL_MS,
  });

  return derive(query, resultsRevision);
}

/** A single (non-paged) history object, e.g. prior winners. */
export function useHistoryObject<T>(
  key: readonly unknown[],
  url: string | null,
  enabled = true
) {
  const config = useRuntimeConfig();
  const cycle = config?.electionYear ?? null;

  const query = useQuery({
    queryKey: [...key, cycle],
    queryFn: ({ signal }) => fetchJsonWithMeta<T>(url!, signal),
    enabled: enabled && !!url && !!cycle,
    staleTime: 5 * 60_000,
  });

  const data = query.data?.data ?? null;
  return {
    data,
    meta: query.data?.meta ?? null,
    state:
      data === null
        ? query.isError
          ? errorState(query.error)
          : ('loading' as HistoryLoadState)
        : query.isError || query.data?.meta?.state === 'stale'
          ? ('stale' as HistoryLoadState)
          : ('ready' as HistoryLoadState),
    loading: query.isPending && data === null,
    error: query.error instanceof Error ? query.error.message : null,
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Wire socket activity to the query cache.
 *
 * A results update invalidates the history queries. Only active ones refetch
 * immediately; inactive ones are marked stale and refresh when mounted, so a
 * tick does not fetch every electorate the visitor is not looking at. A socket
 * reconnect and a browser focus both recover after a gap.
 */
export function useHistorySocketSync(): void {
  const { resultsUpdatedAt, connected } = useSocket();
  const client = useQueryClient();
  const lastUpdate = useRef<number | null>(null);
  const wasConnected = useRef(connected);

  useEffect(() => {
    const at = resultsUpdatedAt?.getTime() ?? null;
    if (at === null || at === lastUpdate.current) return;
    lastUpdate.current = at;
    void client.invalidateQueries({ queryKey: ['history'] });
  }, [resultsUpdatedAt, client]);

  useEffect(() => {
    if (connected && !wasConnected.current) {
      void client.invalidateQueries({ queryKey: ['history'] });
      void client.invalidateQueries({ queryKey: ['voting-places'] });
    }
    wasConnected.current = connected;
  }, [connected, client]);
}
