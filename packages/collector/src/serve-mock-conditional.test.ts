import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'net';
import { once } from 'events';
import type { Server as HttpServer } from 'http';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * The mock is the only way to exercise conditional polling offline, so the
 * headers it has to produce are pinned here rather than being checked by hand
 * on a live run.
 */
describe('mock feed conditional headers', () => {
  let port: number;
  let server: HttpServer;
  let stop: () => void;

  beforeAll(async () => {
    port = await getFreePort();
    process.env.MOCK_PORT = String(port);
    const mock = await import('./serve-mock.js');
    server = mock.server as HttpServer;
    stop = mock.stopMockServer;
    if (!server.listening) await once(server, 'listening');
  }, 30_000);

  afterAll(() => {
    stop?.();
  });

  const url = () => `http://localhost:${port}/e01/e01.xml`;
  const advance = async () => {
    const res = await fetch(`http://localhost:${port}/advance`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  };

  test('an unchanged stage answers 304 with no body', async () => {
    const first = await fetch(url());
    expect(first.status).toBe(200);
    const lastModified = first.headers.get('last-modified');
    expect(lastModified).toBeTruthy();
    await first.text();

    const revalidated = await fetch(url(), {
      headers: { 'If-Modified-Since': lastModified as string },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
  });

  test('a new stage moves Last-Modified, so the same header gets a body', async () => {
    const first = await fetch(url());
    const lastModified = first.headers.get('last-modified') as string;
    await first.text();

    await advance();

    const after = await fetch(url(), {
      headers: { 'If-Modified-Since': lastModified },
    });
    expect(after.status).toBe(200);
    expect(after.headers.get('last-modified')).not.toBe(lastModified);
    expect((await after.text()).length).toBeGreaterThan(0);
  });

  test('a request with no conditional header always gets a body', async () => {
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });
});
