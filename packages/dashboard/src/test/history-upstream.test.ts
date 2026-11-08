import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createHistorySource,
  DEFAULT_MAX_STALE_MS,
} from '../../server/history-upstream.js';
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

  it('returns parsed JSON as a verified read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ snapshotId: 1 }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const read = await source.snapshotMetas();

    expect(read).toMatchObject({
      data: [{ snapshotId: 1 }],
      state: 'verified',
      unavailable: false,
    });
    expect(read.verifiedAt).toEqual(expect.any(Number));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://history.example.com/history/snapshots');
    expect((init as RequestInit).headers).toBeUndefined();
  });

  it('caches responses within the TTL and keeps the verification time', async () => {
    let clock = 1_000_000;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    const first = await source.snapshotMetas();
    clock += 59_000;
    const second = await source.snapshotMetas();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.state).toBe('cached');
    expect(second.verifiedAt).toBe(first.verifiedAt);
    expect(second.data).toEqual([]);
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

  it('treats a collector 503 as unavailable, never as an empty count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const read = await source.partyVoteHistory();

    expect(read).toMatchObject({
      data: null,
      state: 'stale',
      reason: 'upstream-unavailable',
      unavailable: true,
    });
  });

  it('treats any other upstream error as unavailable when nothing is cached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const read = await source.partyVoteHistory();

    expect(read).toMatchObject({
      data: null,
      state: 'stale',
      reason: 'upstream-error',
      unavailable: true,
    });
  });

  it('serves a stale value inside the stale window and reports how old it is', async () => {
    let clock = 1_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]))
      .mockRejectedValueOnce(new Error('connection refused'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 0, // always expired → always refetches
      now: () => clock,
    });

    const first = await source.snapshotMetas();
    expect(first.state).toBe('verified');

    clock += 30_000;
    const stale = await source.snapshotMetas();
    expect(stale).toMatchObject({
      data: [{ snapshotId: 1 }],
      state: 'stale',
      reason: 'upstream-unreachable',
      unavailable: false,
    });
    expect(stale.verifiedAt).toBe(first.verifiedAt);
  });

  it('refuses to serve a stale value older than the stale limit', async () => {
    let clock = 1_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]))
      .mockRejectedValueOnce(new Error('refused'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 0,
      now: () => clock,
    });

    await source.snapshotMetas();
    clock += DEFAULT_MAX_STALE_MS + 1;
    const read = await source.snapshotMetas();

    expect(read).toMatchObject({
      data: null,
      state: 'stale',
      reason: 'stale-too-old',
      unavailable: true,
    });
  });

  it('reports unavailable rather than throwing when there is no cached value', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('refused'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const read = await source.snapshotMetas();

    expect(read).toMatchObject({
      data: null,
      unavailable: true,
      reason: 'upstream-unreachable',
    });
  });

  it('treats an invalid JSON body as a verification failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const read = await source.snapshotMetas();

    expect(read).toMatchObject({
      data: null,
      unavailable: true,
      reason: 'invalid-response',
    });
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });
    const first = source.snapshotMetas();
    const second = source.snapshotMetas();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch!(jsonResponse(200, [{ snapshotId: 7 }]));
    const [a, b] = await Promise.all([first, second]);

    expect(a.data).toEqual([{ snapshotId: 7 }]);
    expect(b.data).toEqual([{ snapshotId: 7 }]);
  });

  it('clears a failed in-flight entry so the next call retries', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
    });

    const failed = await source.snapshotMetas();
    expect(failed.unavailable).toBe(true);

    const recovered = await source.snapshotMetas();
    expect(recovered).toMatchObject({
      data: [{ snapshotId: 1 }],
      state: 'verified',
      unavailable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a verified refresh updates the verification time without inventing a vote change', async () => {
    let clock = 1_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]))
      .mockResolvedValueOnce(jsonResponse(200, [{ snapshotId: 1 }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 0,
      now: () => clock,
    });

    const first = await source.snapshotMetas();
    clock += 5_000;
    const second = await source.snapshotMetas();

    expect(second.data).toEqual(first.data);
    expect(second.state).toBe('verified');
    expect(second.verifiedAt).toBe(clock);
    expect(second.verifiedAt).not.toBe(first.verifiedAt);
  });

  it('an allowed 404 is a verified absence and is not cached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    register.resetMetrics();

    const source = createHistorySource({
      baseUrl: 'https://history.example.com',
      cacheTtlMs: 60_000,
    });

    const first = await source.resultsForYear('2014');
    const second = await source.resultsForYear('2014');

    expect(first).toMatchObject({
      data: null,
      state: 'verified',
      unavailable: false,
    });
    expect(second.state).toBe('verified');
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it('records upstream, cache and verification-failure metrics', async () => {
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
    await source.snapshotMetas(); // miss + ok
    await source.snapshotMetas(); // miss + stale served

    const output = await register.metrics();
    expect(output).toContain(
      'election_history_cache_events_total{result="miss"} 2'
    );
    expect(output).toContain(
      'election_history_upstream_requests_total{route="/history/snapshots",outcome="ok"} 1'
    );
    expect(output).toContain(
      'election_history_upstream_requests_total{route="/history/snapshots",outcome="stale_served"} 1'
    );
    expect(output).toContain(
      'election_history_verification_failures_total{route="/history/snapshots",reason="upstream-unreachable"} 1'
    );
    expect(output).toContain(
      'election_history_stale_serve_age_seconds_count{route="/history/snapshots"} 1'
    );
  });
});
