import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHealthServer, health } from './health.js';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function waitForListening(server: http.Server): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve) => server.once('listening', () => resolve()));
}

describe('collector health server', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => {
      server!.closeAllConnections();
      server!.close(() => resolve());
    });
    server = undefined;
  });

  function baseUrl(): string {
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('serves application-tier Prometheus metrics on /metrics', async () => {
    server = startHealthServer(0);
    await waitForListening(server);

    const res = await fetch(`${baseUrl()}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const body = await res.text();
    // Seeded at import, so the series exists before the first scrape.
    expect(body).toContain('election_collector_socket_connected 0');
    expect(body).toContain('election_scrape_duration_seconds');
  });

  it('serves live collector state on /health', async () => {
    server = startHealthServer(0);
    await waitForListening(server);

    const res = await fetch(`${baseUrl()}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof health;
    expect(body.cycleCount).toBe(health.cycleCount);
  });

  it('404s unknown paths', async () => {
    server = startHealthServer(0);
    await waitForListening(server);

    const res = await fetch(`${baseUrl()}/nope`);
    expect(res.status).toBe(404);
  });
});
