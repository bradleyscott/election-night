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
import { probeCollectorHealth } from './collector-watchdog.js';

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

/**
 * What the collector actually loaded, as opposed to what this server was
 * configured with. The 2026 launch left production publishing 2023 data while
 * `/api/config` happily reported 2026; the only way to tell was to dump a
 * Socket.io frame. Surfacing the source name and the diff-cache cycle here makes
 * "wrong feed", "stale cache" and "no feed yet" distinguishable at a glance.
 */
export interface CollectorIdentity {
  source: string | null;
  cacheYear: string | null;
  electionYear: string | null;
}

async function collectorIdentity(): Promise<CollectorIdentity> {
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

/** Injected by tests; production uses the real probe and identity fetch. */
export interface ReadinessDeps {
  probe?: () => Promise<boolean>;
  identity?: () => Promise<CollectorIdentity>;
}

export async function serveReady(
  _req: IncomingMessage,
  res: ServerResponse,
  feedEvents: { timestamp: number }[],
  deps: ReadinessDeps = {}
) {
  // Ask the collector's HTTP surface directly. A cached history value is not a
  // dependency check: the exact failure this guards against is a wedged
  // listener while old history is still being served from cache.
  const probe =
    deps.probe ??
    (() => probeCollectorHealth(dashboardServerConfig.historyUpstream, 1500));
  const historyReachable = await probe();
  const collector = await (deps.identity ?? collectorIdentity)();

  const lastEvent = feedEvents[feedEvents.length - 1];
  const lastScrape = lastEvent ? lastEvent.timestamp : 'none';

  const { ready, checks } = evaluateReady(historyReachable, lastScrape);

  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready, checks: { ...checks, ...collector } }));
}
