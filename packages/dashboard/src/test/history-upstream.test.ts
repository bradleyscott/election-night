import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHistorySource } from '../../server/history-upstream.js';
import { register } from '../../server/metrics.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('history source (collector REST API client)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('returns parsed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ snapshotId: 1 }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const metas = await source.snapshotMetas();

    expect(metas).toEqual([{ snapshotId: 1 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://history.example.com/history/snapshots');
    expect((init as RequestInit).headers).toBeUndefined();
  });

  it('caches responses within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 60_000,
    });
    await source.snapshotMetas();
    await source.snapshotMetas();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('URL-encodes electorate names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    await source.electorateHistory('Te Tai Tonga');

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://history.example.com/history/electorate/Te%20Tai%20Tonga'
    );
  });

  it('treats a 503 (DB not created yet) as empty rather than an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    await expect(source.partyVoteHistory()).resolves.toEqual([]);
  });

  it('serves the stale cached value when the upstream errors or is unreachable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]))
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockRejectedValueOnce(new Error('connection refused'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 0, // always expired → always refetches
    });

    // Prime the cache.
    await expect(source.snapshotMetas()).resolves.toEqual([{ snapshotId: 1 }]);
    // Upstream error (e.g. proxy rate limit) → stale cache instead of a throw.
    await expect(source.snapshotMetas()).resolves.toEqual([{ snapshotId: 1 }]);
    // Network failure → stale cache instead of a throw.
    await expect(source.snapshotMetas()).resolves.toEqual([{ snapshotId: 1 }]);
  });

  it('throws when unreachable with no cached value', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('refused'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    await expect(source.snapshotMetas()).rejects.toThrow('unreachable');
  });

  it('clearCache drops cached values', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, [{ snapshotId: 1 }]))
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 60_000,
    });

    await source.snapshotMetas();
    source.clearCache();
    await source.snapshotMetas();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on upstream errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    await expect(source.snapshotMetas()).rejects.toThrow('responded 500');
  });

  it('records upstream and cache events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    register.resetMetrics();

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 60_000,
    });
    await source.snapshotMetas(); // miss + ok
    await source.snapshotMetas(); // hit

    const output = await register.metrics();
    expect(output).toContain(
      'election_history_cache_events_total{result="miss"} 1'
    );
    expect(output).toContain(
      'election_history_cache_events_total{result="hit"} 1'
    );
    expect(output).toContain(
      'election_history_upstream_requests_total{route="/history/snapshots",outcome="ok"} 1'
    );
    expect(output).toContain(
      'election_history_upstream_request_duration_seconds_count{route="/history/snapshots"} 1'
    );
  });

  it('records a stale serve when the upstream fails after a cached response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]))
      .mockRejectedValueOnce(new Error('refused'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    register.resetMetrics();

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 0,
    });
    await source.snapshotMetas();
    await source.snapshotMetas(); // upstream down → stale cache served

    const output = await register.metrics();
    expect(output).toContain(
      'election_history_upstream_requests_total{route="/history/snapshots",outcome="stale_served"} 1'
    );
    expect(output).toContain(
      'election_history_cache_events_total{result="stale"} 1'
    );
  });
});
