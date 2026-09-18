import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { IncomingMessage, ServerResponse } from 'http';

let serveStatic: (req: IncomingMessage, res: ServerResponse) => void;

/** Minimal ServerResponse capture. */
function fakeRes() {
  const captured = { status: 0, body: '', headers: {} as Record<string, unknown> };
  const res = {
    writeHead(status: number, headers?: Record<string, unknown>) {
      captured.status = status;
      if (headers) captured.headers = headers;
      return res;
    },
    end(body?: string | Buffer) {
      captured.body = body ? body.toString() : '';
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

function fakeReq(method: string, url: string) {
  return { method, url, headers: { host: 'localhost' } } as IncomingMessage;
}

beforeAll(async () => {
  const distDir = mkdtempSync(join(tmpdir(), 'static-test-'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><h1>ok</h1>');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)');

  // DIST_DIR is read at module load, so set it before importing.
  process.env.DIST_DIR = distDir;
  ({ serveStatic } = await import('./static.js'));
});

describe('serveStatic', () => {
  it('serves index.html at the root', () => {
    const { res, captured } = fakeRes();
    serveStatic(fakeReq('GET', '/'), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('ok');
  });

  it('falls back to index.html for client-side routes', () => {
    const { res, captured } = fakeRes();
    serveStatic(fakeReq('GET', '/seats/national'), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('ok');
  });

  it('serves a real asset with its content type', () => {
    const { res, captured } = fakeRes();
    serveStatic(fakeReq('GET', '/assets/app.js'), res);
    expect(captured.status).toBe(200);
    expect(captured.headers['Content-Type']).toBe('application/javascript');
    expect(captured.body).toBe('console.log(1)');
  });

  /**
   * The SPA fallback must not answer non-GET requests: a 200 with an HTML body
   * would make a removed endpoint (e.g. the deleted POST /api/clear) look like
   * it succeeded.
   */
  it('rejects non-GET/HEAD with 405 instead of falling back to the SPA', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const { res, captured } = fakeRes();
      serveStatic(fakeReq(method, '/api/clear'), res);
      expect(captured.status).toBe(405);
      expect(captured.headers['Allow']).toBe('GET, HEAD');
      expect(captured.body).not.toContain('ok');
    }
  });
});
