/**
 * The dashboard server's operational endpoints: `/health`, `/ready`, `/metrics`.
 *
 * Kept apart from `static.ts`, which serves the built SPA: these three answer
 * the orchestrator and the scraper and never touch a filesystem. Fly scrapes
 * exactly one metrics endpoint per process, so `/metrics` merges the
 * collector's registry (see `collector-metrics.ts`) rather than being scraped
 * separately.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { register } from './metrics.js';
import { collectMetricsBody } from './collector-metrics.js';
import { dashboardServerConfig } from './config.js';
import type { HistorySource } from './history-upstream.js';

/**
 * Readiness, from the one dependency this process cannot synthesise: the
 * collector's history API. A feed with no events yet is still ready — the
 * dashboard shows its waiting state — but an unreachable historian means no
 * page can answer.
 *
 * Exported for its own test; `serveReady` is the only caller.
 */
export function evaluateReady(
  historyReachable: boolean,
  lastScrape: number | 'none'
): { ready: boolean; checks: Record<string, string | number> } {
  const checks: Record<string, string | number> = {};
  let ready = true;

  if (historyReachable) {
    checks.history = 'upstream';
  } else {
    checks.history = 'error';
    ready = false;
  }

  checks.lastScrape = lastScrape;

  return { ready, checks };
}

export async function serveMetrics(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const metrics = await collectMetricsBody();
  res.writeHead(200, { 'Content-Type': register.contentType });
  res.end(metrics);
}

export function serveHealth(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

async function isHistoryReachable(source: HistorySource): Promise<boolean> {
  try {
    await source.snapshotMetas();
    return true;
  } catch {
    return false;
  }
}

/**
 * What the collector actually loaded, as opposed to what this server was
 * configured with. The 2026 launch left production publishing 2023 data while
 * `/api/config` happily reported 2026; the only way to tell was to dump a
 * Socket.io frame. Surfacing the source name and the diff-cache cycle here makes
 * "wrong feed", "stale cache" and "no feed yet" distinguishable at a glance.
 */
async function collectorIdentity(): Promise<{
  source: string | null;
  cacheYear: string | null;
  electionYear: string | null;
}> {
  const empty = { source: null, cacheYear: null, electionYear: null };
  try {
    const base = dashboardServerConfig.historyUpstream.replace(/\/+$/, '');
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return empty;
    const body = (await res.json()) as Record<string, unknown>;
    return {
      source: typeof body.source === 'string' ? body.source : null,
      cacheYear: typeof body.cacheYear === 'string' ? body.cacheYear : null,
      electionYear:
        typeof body.electionYear === 'string' ? body.electionYear : null,
    };
  } catch {
    return empty;
  }
}

export async function serveReady(
  _req: IncomingMessage,
  res: ServerResponse,
  historySource: HistorySource,
  feedEvents: { timestamp: number }[]
) {
  const historyReachable = await isHistoryReachable(historySource);
  const collector = await collectorIdentity();

  const lastEvent = feedEvents[feedEvents.length - 1];
  const lastScrape = lastEvent ? lastEvent.timestamp : 'none';

  const { ready, checks } = evaluateReady(historyReachable, lastScrape);

  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready, checks: { ...checks, ...collector } }));
}
