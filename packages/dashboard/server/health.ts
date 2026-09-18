import type { IncomingMessage, ServerResponse } from 'http';
import type { CollectorState } from '@election-night/collector';
import { register, metricsResponse } from './metrics.js';
import { evaluateReady, type CollectorStatus } from './ready-check.js';

export function serveMetrics(_req: IncomingMessage, res: ServerResponse): void {
  void metricsResponse().then((metrics) => {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(metrics);
  });
}

/**
 * Liveness plus a snapshot of collector state. Fly probes this every 10s and
 * treats any response as healthy, so it reports state rather than failing.
 * It replaces the collector's old standalone health server on port 3459.
 */
export function serveHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  input: {
    collector: CollectorStatus;
    collectorState: CollectorState;
    historyAvailable: boolean;
  }
): void {
  const { collector, collectorState: state, historyAvailable } = input;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      collector: {
        status: collector,
        running: state.running,
        cycleCount: state.cycleCount,
        lastCycleOk: state.lastCycleOk,
        lastError: state.lastError,
        lastCycleFinishedAt: state.lastCycleFinishedAt,
        lastVotesCounted: state.lastVotesCounted,
        resultCount: state.lastResultCount,
        electorateCount: state.electorateCount,
      },
      history: { available: historyAvailable },
    })
  );
}

export function serveReady(
  _req: IncomingMessage,
  res: ServerResponse,
  input: {
    historyAvailable: boolean;
    collector: CollectorStatus;
    lastScrape: number | 'none';
  }
): void {
  const { ready, checks } = evaluateReady(input);
  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready, checks }));
}
