/**
 * Pure ready-state evaluation used by the /ready HTTP handler.
 *
 * Readiness answers "is this deployment actually working end to end?" — which,
 * with the collector running in-process, means it has completed a scrape and
 * written a snapshot. A dashboard-only node (`COLLECTOR_ENABLED=false`) has
 * nothing to wait for and is ready as soon as it is serving.
 *
 * `/health` is what Fly probes; `/ready` is for humans and CI.
 */

export type CollectorStatus = 'disabled' | 'starting' | 'ok' | 'error';

export function collectorStatus(input: {
  enabled: boolean;
  cycleCount: number;
  lastCycleOk: boolean;
}): CollectorStatus {
  if (!input.enabled) return 'disabled';
  if (input.cycleCount === 0) return 'starting';
  return input.lastCycleOk ? 'ok' : 'error';
}

export function evaluateReady(input: {
  historyAvailable: boolean;
  collector: CollectorStatus;
  lastScrape: number | 'none';
}): { ready: boolean; checks: Record<string, string | number> } {
  const ready = input.collector === 'disabled' || input.collector === 'ok';

  return {
    ready,
    checks: {
      collector: input.collector,
      history: input.historyAvailable ? 'ok' : 'unavailable',
      lastScrape: input.lastScrape,
    },
  };
}
