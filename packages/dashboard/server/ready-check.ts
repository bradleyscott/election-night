/**
 * Pure ready-state evaluation used by the /ready HTTP handler.
 *
 * Readiness is based on history upstream reachability. An empty feed event
 * list does not make the server unready, but the last scrape timestamp is
 * still reported in the checks payload when available.
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
