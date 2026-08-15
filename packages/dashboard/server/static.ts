import { existsSync, readFileSync, statSync } from 'fs';
import { extname, resolve, sep } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { register, metricsResponse } from './metrics.js';
import { dashboardServerConfig } from './config.js';
import type { HistorySource } from './history-upstream.js';
import { log } from './logger.js';

const DIST_DIR = dashboardServerConfig.distDir;

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

function sendFile(
  res: ServerResponse,
  path: string,
  contentType: string
): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  try {
    const content = readFileSync(path);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    return false; // fall through to SPA fallback
  }
}

export async function serveMetrics(_req: IncomingMessage, res: ServerResponse) {
  const metrics = await metricsResponse();
  res.writeHead(200, { 'Content-Type': register.contentType });
  res.end(metrics);
}

export function serveHealth(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

export async function serveReady(
  _req: IncomingMessage,
  res: ServerResponse,
  historySource: HistorySource,
  feedEvents: { timestamp: number }[]
) {
  const checks: Record<string, string | boolean | number> = {};
  let ready = true;

  try {
    await historySource.snapshotMetas();
    checks.history = 'upstream';
  } catch {
    checks.history = 'error';
    ready = false;
  }

  const lastEvent = feedEvents[feedEvents.length - 1];
  if (lastEvent) {
    checks.lastScrape = lastEvent.timestamp;
  } else {
    checks.lastScrape = 'none';
    ready = false;
  }

  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready, checks }));
}

/**
 * Serve the built Vite bundle with an SPA fallback for client-side routes.
 * (Health/ready/metrics have simpler handlers of their own.)
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = resolve(DIST_DIR, normalizedPath.slice(1));

  // Path-traversal guard: `sep` suffix so a sibling like `dist-evil`
  // can't pass the prefix check.
  if (!resolvedPath.startsWith(DIST_DIR + sep)) {
    log.warn(`Rejected path outside DIST_DIR: ${pathname}`);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = extname(resolvedPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  if (sendFile(res, resolvedPath, contentType)) return;

  // SPA fallback — serve index.html for client-side routes
  if (!sendFile(res, resolve(DIST_DIR, 'index.html'), 'text/html')) {
    res.writeHead(404);
    res.end('Not found');
  }
}
