/**
 * Serving the built Vite bundle: MIME lookup, a path-traversal guard, cache
 * headers, and the SPA fallback.
 *
 * The operational endpoints (`/health`, `/ready`, `/metrics`) are in
 * `health.ts`, and the data routes are in `api.ts`.
 *
 * Every file is read once and kept in memory. `dist/` is a few megabytes whose
 * contents only change on deploy (which restarts the process), so reading it
 * again per request is pure overhead. It is also why the reads are async: a
 * 1.3 MB `readFileSync` of the bundle blocks the event loop for every visitor
 * while the poll payloads and sockets behind them wait.
 */

import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { extname, join, resolve, sep } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from './logger.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/**
 * Vite fingerprints everything under `/assets/` with a content hash, so the
 * filename changes whenever the bytes do. A stale copy can never be served,
 * which is what makes a year-long cache safe.
 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * Everything else keeps its name across deploys (`index.html`, the icons, the
 * boundary GeoJSON), so it has to be revalidated. The ETag makes that a 304
 * with no body rather than a fresh download.
 */
const REVALIDATE_CACHE = 'no-cache';

type CachedFile = {
  content: Buffer;
  etag: string;
  contentType: string;
  cacheControl: string;
};

type StaticHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path)] || 'application/octet-stream';
}

function etagFor(content: Buffer): string {
  return `"${createHash('sha1').update(content).digest('base64url')}"`;
}

function matchesEtag(
  header: string | string[] | undefined,
  etag: string
): boolean {
  if (!header) return false;
  const value = Array.isArray(header) ? header.join(',') : header;
  if (value.trim() === '*') return true;
  return value
    .split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  file: CachedFile
): void {
  const headers = {
    'Content-Type': file.contentType,
    'Cache-Control': file.cacheControl,
    ETag: file.etag,
  };

  if (matchesEtag(req.headers['if-none-match'], file.etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': String(file.content.length),
  });
  res.end(req.method === 'HEAD' ? undefined : file.content);
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

/**
 * A request for a file that should exist, rather than a client-side route.
 * Extensionless paths are routes (`/seats`, `/close-calls`); a real extension
 * that did not resolve is a missing file, and `/assets/` is never a route.
 */
function isFileRequest(pathname: string): boolean {
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return true;
  const ext = extname(pathname);
  return ext !== '' && ext !== '.html';
}

/**
 * Build the static handler for one `dist` directory. The handler owns its file
 * cache, so a test gets its own copy and two servers in one process cannot
 * serve each other's bundle.
 */
export function createStaticHandler(distDir: string): StaticHandler {
  const root = resolve(distDir);
  // A burst of requests for the bundle at the same instant shares one read.
  const files = new Map<string, Promise<CachedFile>>();

  function load(path: string, cacheControl: string): Promise<CachedFile> {
    const cached = files.get(path);
    if (cached) return cached;

    const pending = readFile(path).then((content) => ({
      content,
      etag: etagFor(content),
      contentType: contentTypeFor(path),
      cacheControl,
    }));
    files.set(path, pending);
    // A miss must not be remembered: otherwise an asset added by a later
    // deploy 404s until the next restart. Deleting the entry lets the next
    // request try the disk again. Only drop it if it is still this attempt's
    // entry, so a slow failure cannot evict a newer successful read.
    pending.catch(() => {
      if (files.get(path) === pending) files.delete(path);
    });
    return pending;
  }

  return async function serveStatic(req, res) {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    const normalizedPath = pathname === '/' ? '/index.html' : pathname;
    const resolvedPath = resolve(root, normalizedPath.slice(1));

    // Path-traversal guard: `sep` suffix so a sibling like `dist-evil`
    // can't pass the prefix check.
    if (!resolvedPath.startsWith(root + sep)) {
      log.warn(`Rejected path outside DIST_DIR: ${pathname}`);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const cacheControl = normalizedPath.startsWith('/assets/')
      ? IMMUTABLE_CACHE
      : REVALIDATE_CACHE;

    try {
      send(req, res, await load(resolvedPath, cacheControl));
      return;
    } catch {
      // Not on disk — fall through to the SPA fallback or a 404.
    }

    // A missing file is a 404, never the SPA shell. Answering a stale asset
    // hash with `index.html` and a 200 hands the browser HTML where it asked
    // for JavaScript, which it refuses to execute: the tab goes blank instead
    // of reloading onto the build that is actually deployed.
    if (isFileRequest(normalizedPath)) {
      notFound(res);
      return;
    }

    // SPA fallback — serve index.html for client-side routes
    try {
      send(req, res, await load(join(root, 'index.html'), REVALIDATE_CACHE));
    } catch {
      notFound(res);
    }
  };
}
