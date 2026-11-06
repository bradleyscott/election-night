import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { createStaticHandler } from './static.js';

type Captured = {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer | undefined;
};

async function request(
  handler: ReturnType<typeof createStaticHandler>,
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<Captured> {
  const captured: Captured = { status: 0, headers: {}, body: undefined };

  const req = {
    url,
    method: options.method ?? 'GET',
    headers: { host: 'localhost', ...(options.headers ?? {}) },
  } as unknown as IncomingMessage;

  const res = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(body?: string | Buffer) {
      captured.body = body;
    },
  } as unknown as ServerResponse;

  await handler(req, res);
  return captured;
}

describe('static handler', () => {
  let root: string;
  let handler: ReturnType<typeof createStaticHandler>;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'election-night-static-'));
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'boundaries', '2026'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<html>shell</html>');
    writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log("app")');
    writeFileSync(join(root, 'favicon.svg'), '<svg></svg>');
    writeFileSync(join(root, 'boundaries', '2026', 'general.geojson'), '{}');
    handler = createStaticHandler(root);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('caches fingerprinted assets for a year, immutably', async () => {
    const res = await request(handler, '/assets/index-abc123.js');

    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(res.headers['Content-Type']).toBe('application/javascript');
    expect(String(res.body)).toBe('console.log("app")');
  });

  it('revalidates the shell instead of caching it', async () => {
    const res = await request(handler, '/');

    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Content-Type']).toBe('text/html');
    expect(String(res.body)).toBe('<html>shell</html>');
  });

  it('revalidates named files that survive a deploy', async () => {
    const res = await request(handler, '/boundaries/2026/general.geojson');

    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-cache');
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const first = await request(handler, '/assets/index-abc123.js');
    const etag = first.headers.ETag;

    const second = await request(handler, '/assets/index-abc123.js', {
      headers: { 'if-none-match': etag },
    });

    expect(second.status).toBe(304);
    expect(second.body).toBeUndefined();
    expect(second.headers.ETag).toBe(etag);
  });

  it('treats a weak validator as matching', async () => {
    const first = await request(handler, '/');
    const etag = first.headers.ETag;

    const second = await request(handler, '/', {
      headers: { 'if-none-match': `W/${etag}` },
    });

    expect(second.status).toBe(304);
  });

  it('serves the build once and keeps it in memory', async () => {
    const url = '/favicon.svg';
    const first = await request(handler, url);
    writeFileSync(join(root, 'favicon.svg'), '<svg>changed</svg>');
    const second = await request(handler, url);

    expect(String(first.body)).toBe('<svg></svg>');
    expect(String(second.body)).toBe('<svg></svg>');
  });

  it('falls back to the shell for a client-side route', async () => {
    const res = await request(handler, '/close-calls');

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
    expect(String(res.body)).toBe('<html>shell</html>');
  });

  it('404s a missing asset rather than serving the shell as JavaScript', async () => {
    const res = await request(handler, '/assets/index-gone.js');

    expect(res.status).toBe(404);
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(String(res.body)).toBe('Not found');
  });

  it('404s any missing file that has an extension', async () => {
    for (const url of ['/favicon-gone.svg', '/assets/nested/missing.css']) {
      const res = await request(handler, url);
      expect(res.status).toBe(404);
      expect(String(res.body)).toBe('Not found');
    }
  });

  it('retries a miss instead of remembering it', async () => {
    const url = '/assets/index-later.js';
    expect((await request(handler, url)).status).toBe(404);

    writeFileSync(join(root, 'assets', 'index-later.js'), 'later');
    const res = await request(handler, url);

    expect(res.status).toBe(200);
    expect(String(res.body)).toBe('later');
  });

  it('sends headers but no body for HEAD', async () => {
    const res = await request(handler, '/assets/index-abc123.js', {
      method: 'HEAD',
    });

    expect(res.status).toBe(200);
    expect(res.headers['Content-Length']).toBe(
      String(Buffer.byteLength('console.log("app")'))
    );
    expect(res.body).toBeUndefined();
  });
});
