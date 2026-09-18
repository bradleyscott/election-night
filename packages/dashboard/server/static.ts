import { existsSync, readFileSync, statSync } from 'fs';
import { extname, resolve, sep } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { dashboardServerConfig } from './config.js';
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

/**
 * Serve the built Vite bundle with an SPA fallback for client-side routes.
 * (Health/ready/metrics have their own handlers — see health.ts.)
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse): void {
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
