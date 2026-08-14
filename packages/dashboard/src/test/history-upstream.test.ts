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

  it('sends the bearer token and returns parsed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ snapshotId: 1 }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      token: 'sekrit',
    });
    const metas = await source.snapshotMetas();

    expect(metas).toEqual([{ snapshotId: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://history.example.com/history/snapshots');
    expect((init as RequestInit).headers).toEqual({
      authorization: 'Bearer sekrit',
    });
  });

  it('omits the auth header when no token is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'http://127.0.0.1:3459',
    });
    await source.snapshotMetas();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toEqual({});
  });

  it('caches responses within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      token: 'sekrit',
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
      token: 'sekrit',
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
      token: 'sekrit',
    });
    await expect(source.partyVoteHistory()).resolves.toEqual([]);
  });

  it('throws on upstream errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      token: 'wrong',
    });
    await expect(source.snapshotMetas()).rejects.toThrow('responded 401');
  });
});
