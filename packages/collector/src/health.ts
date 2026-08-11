import http from 'node:http';
import { log } from './logger.js';

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
 * Tiny state server (node:http, no deps) so Coolify can healthcheck the
 * worker and we can inspect live state on election night. Binds 0.0.0.0 so
 * both in-container probes and the future Caddy proxy (variant B history
 * REST, which will share this HTTP server) can reach it; no host port is
 * mapped and nothing is exposed publicly.
 */
export function startHealthServer(port: number): void {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
  server.on('error', (err) => {
    log.error(`Health server failed on port ${port}`, err);
  });
  server.listen(port, '0.0.0.0', () => {
    log.info(`Health server listening on http://0.0.0.0:${port}/health`);
  });
}
