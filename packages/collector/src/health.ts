import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { log } from './logger.js';
import { collectorRegister } from './metrics.js';

export interface CollectorHealthState {
  startedAt: number;
  cycleCount: number;
  lastCycleStartedAt: number | null;
  lastCycleFinishedAt: number | null;
  lastCycleOk: boolean;
  lastError: string | null;
  lastVotesCounted: number | null;
  socketConnected: boolean;
  socketUrl: string | null;
  lastPublishAt: number | null;
}

export const health: CollectorHealthState = {
  startedAt: Date.now(),
  cycleCount: 0,
  lastCycleStartedAt: null,
  lastCycleFinishedAt: null,
  lastCycleOk: false,
  lastError: null,
  lastVotesCounted: null,
  socketConnected: false,
  socketUrl: null,
  lastPublishAt: null,
};

/**
 * Tiny state server (node:http, no deps) so container orchestrators can healthcheck the
 * worker and we can inspect live state on election night. Binds 0.0.0.0 so
 * in-container probes, the reverse proxy, the Fly metrics scraper and the
 * history REST routes (mounted via `handleRoute`) can all reach it. `/health`
 * and `/metrics` stay open (nothing sensitive). `/history/*` are unauthenticated
 * and are NOT rate limited in-process — rate limiting belongs at the reverse
 * proxy / firewall in front of the collector.
 */
export function startHealthServer(
  port: number,
  handleRoute?: (req: IncomingMessage, res: ServerResponse) => boolean
): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
      return;
    }
    // Application-tier Prometheus metrics. Fly scrapes this as a second
    // target (see the `[[metrics]]` sections in fly.toml).
    if (req.method === 'GET' && req.url === '/metrics') {
      res.writeHead(200, { 'content-type': collectorRegister.contentType });
      res.end(await collectorRegister.metrics());
      return;
    }
    if (handleRoute?.(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
  server.on('error', (err) => {
    log.error(`Health server failed on port ${port}`, err);
  });
  server.listen(port, '0.0.0.0', () => {
    log.info(`Health server listening on http://0.0.0.0:${port}/health`);
  });
  return server;
}
