import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /metrics` must not lose the collector's series because one fetch was
 * slow. The collector serves its exposition from the same event loop it writes
 * SQLite on, so a snapshot write or retention sweep can delay it past the
 * merge deadline. The previous body is served while `reachable` goes to 0.
 */

const collectorText =
  '# HELP election_votes_counted Total votes counted\n' +
  '# TYPE election_votes_counted gauge\n' +
  'election_votes_counted 1000\n';

function ok(text: string) {
  return { ok: true, status: 200, text: async () => text };
}

describe('collectMetricsBody', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merges the collector exposition when the fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(collectorText)));

    const { collectMetricsBody } = await import('./collector-metrics.js');
    const body = await collectMetricsBody();

    expect(body).toContain('election_votes_counted 1000');
    expect(body).toContain('election_websocket_clients_connected');
    expect(body).toContain('election_collector_metrics_reachable 1');
  });

  it('serves the server series alone when the collector has never answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    );

    const { collectMetricsBody } = await import('./collector-metrics.js');
    const body = await collectMetricsBody();

    expect(body).not.toContain('election_votes_counted 1000');
    expect(body).toContain('election_websocket_clients_connected');
    expect(body).toContain('election_collector_metrics_reachable 0');
  });

  it('serves the last successful collector exposition when a later fetch fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(collectorText))
      .mockRejectedValueOnce(
        Object.assign(new Error('This operation was aborted'), {
          name: 'AbortError',
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { collectMetricsBody } = await import('./collector-metrics.js');
    await collectMetricsBody();
    const body = await collectMetricsBody();

    // The gap would otherwise erase every collector-owned panel for a scrape.
    expect(body).toContain('election_votes_counted 1000');
    expect(body).toContain('election_collector_metrics_reachable 0');
  });

  it('replaces the cached exposition on the next successful fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(collectorText))
      .mockRejectedValueOnce(new Error('This operation was aborted'))
      .mockResolvedValueOnce(ok(collectorText.replace('1000', '2000')));
    vi.stubGlobal('fetch', fetchMock);

    const { collectMetricsBody } = await import('./collector-metrics.js');
    await collectMetricsBody();
    await collectMetricsBody();
    const body = await collectMetricsBody();

    expect(body).toContain('election_votes_counted 2000');
    expect(body).not.toContain('election_votes_counted 1000');
    expect(body).toContain('election_collector_metrics_reachable 1');
  });
});
