import { IncomingMessage, ServerResponse } from 'http';
import { resolve, extname } from 'path';
import {
  existsSync,
  statSync,
  readFileSync,
} from 'fs';
import type { Server as SocketServer } from 'socket.io';
import type { ResultsPayload, FeedEvent } from '@election-night/core/types';
import { dashboardServerConfig } from './config.js';
import { log } from './logger.js';
import { register, metricsResponse } from './metrics.js';
import {
  hasDbReader,
  getSnapshotMetas,
  getElectorateHistory,
  getPartyVoteHistory,
  type PaginationOptions,
} from './db-reader.js';

const { distDir: DIST_DIR } = dashboardServerConfig;

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

export type HttpRouterDeps = {
  latestResults: { current: ResultsPayload | null };
  getFeedEvents: () => FeedEvent[];
  io: SocketServer;
  clearState: () => void;
};

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 1000;

function parsePagination(url: URL): Required<PaginationOptions> {
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');
  let limit = parseInt(rawLimit ?? String(DEFAULT_HISTORY_LIMIT), 10);
  if (Number.isNaN(limit) || limit < 1) {
    limit = DEFAULT_HISTORY_LIMIT;
  }
  if (limit > MAX_HISTORY_LIMIT) {
    limit = MAX_HISTORY_LIMIT;
  }
  let offset = parseInt(rawOffset ?? '0', 10);
  if (Number.isNaN(offset) || offset < 0) {
    offset = 0;
  }
  return { limit, offset };
}

export function createHttpRequestHandler(deps: HttpRouterDeps) {
  const { latestResults, getFeedEvents, io, clearState } = deps;

  function serveApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): boolean {
    const pathname = url.pathname;
    const pagination = parsePagination(url);

    if (pathname === '/api/history/snapshots') {
      const metas = getSnapshotMetas(pagination);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metas));
      return true;
    }

    const electorateMatch = pathname.match(/^\/api\/history\/electorate\/(.+)$/);
    if (electorateMatch) {
      const name = decodeURIComponent(electorateMatch[1]);
      const history = getElectorateHistory(name, pagination);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return true;
    }

    if (pathname === '/api/history/party-votes') {
      const history = getPartyVoteHistory(pagination);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return true;
    }

    return false;
  }

  async function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<void> {
    const pathname = url.pathname;

    if (pathname === '/metrics') {
      const metrics = await metricsResponse();
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.end(metrics);
      return;
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (pathname === '/ready') {
      const checks: Record<string, string | boolean | number> = {};
      let ready = true;

      try {
        if (hasDbReader()) {
          getSnapshotMetas();
          checks.db = 'ok';
        } else {
          checks.db = 'no database';
          ready = false;
        }
      } catch {
        checks.db = 'error';
        ready = false;
      }

      const events = getFeedEvents();
      const lastEvent = events[events.length - 1];
      if (lastEvent) {
        checks.lastScrape = lastEvent.timestamp;
      } else {
        checks.lastScrape = 'none';
        ready = false;
      }

      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready, checks }));
      return;
    }

    const normalizedPath = pathname === '/' ? '/index.html' : pathname;
    const resolvedPath = resolve(DIST_DIR, normalizedPath.slice(1));

    if (!resolvedPath.startsWith(DIST_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
      const ext = extname(resolvedPath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      try {
        const content = readFileSync(resolvedPath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
        return;
      } catch {
        // fall through to SPA fallback
      }
    }

    const indexPath = resolve(DIST_DIR, 'index.html');
    if (existsSync(indexPath) && statSync(indexPath).isFile()) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method === 'POST' && req.url === '/api/clear') {
      latestResults.current = null;
      clearState();
      io.emit('clear');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Feed cleared' }));
      return;
    }

    if (req.url) {
      const url = new URL(
        req.url,
        `http://${req.headers.host || 'localhost'}`
      );
      if (serveApi(req, res, url)) return;
      serveStatic(req, res, url).catch((err) => {
        log.error('Unexpected error serving static request', err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal server error');
        }
      });
      return;
    }

    res.writeHead(400);
    res.end('Bad request');
  };
}
