import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHistorySource } from '../../server/history-upstream.js';

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

  it('throws on upstream errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    await expect(source.snapshotMetas()).rejects.toThrow('responded 500');
  });
});
