/**
 * Merged exposition for `GET /metrics`.
 *
 * Fly scrapes exactly one metrics endpoint per process/machine (multiple
 * `[[metrics]]` sections in `fly.toml` only work across Fly *process groups*,
 * which are separate Machines). So rather than asking Fly to scrape the
 * collector directly, the collector's registry is pulled over loopback and
 * appended to the server's own exposition.
 *
 * Kept in its own module (and out of `metrics.ts`) so `metrics.ts` stays
 * importable from the frontend `src` project via tests — this file reads config
 * and uses the Node `fetch`.
 */

import { dashboardServerConfig } from './config.js';
import { log } from './logger.js';
import {
  collectorMetricsReachable,
  mergeMetrics,
  serverMetrics,
} from './metrics.js';

/**
 * How long the collector gets to answer `GET /metrics`.
 *
 * A loopback exposition normally takes a few milliseconds, so this is not a
 * latency budget — it is a liveness budget. The collector serves its metrics
 * from the same single-threaded event loop it writes SQLite on, so a scrape can
 * legitimately be delayed by a snapshot write, a retention sweep
 * (`pruneSnapshots` + `incremental_vacuum`) or parsing every changed seat. Three
 * seconds was short enough that a healthy collector could miss it, and a missed
 * fetch used to erase every collector-owned series from that scrape.
 */
const COLLECTOR_TIMEOUT_MS = 10_000;

/**
 * The last exposition the collector answered with, used only when the current
 * fetch fails.
 *
 * A single slow scrape must not punch a hole in every collector-owned panel:
 * the collector is usually still alive and the next scrape will succeed. The
 * cached body keeps the series continuous while `collectorMetricsReachable`
 * drops to 0 and the heartbeat age grows, so a real outage is still visible and
 * alertable rather than being disguised as absent data.
 */
let lastCollectorText: string | null = null;

export async function collectMetricsBody(): Promise<string> {
  const url = dashboardServerConfig.collectorMetricsUrl;

  if (!url) {
    // Merging is disabled (e.g. a split deployment scrapes the collector
    // directly): there is no hop to report on, so don't alarm on it.
    collectorMetricsReachable.set(1);
    return serverMetrics();
  }

  // Start from the fallback: a failed fetch leaves this in place.
  let collectorText: string | null = lastCollectorText;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`responded ${res.status}`);
    collectorText = await res.text();
    lastCollectorText = collectorText;
    collectorMetricsReachable.set(1);
  } catch (err) {
    collectorMetricsReachable.set(0);
    const elapsedMs = Math.round(performance.now() - startedAt);
    log.warn(
      `Collector metrics not merged from ${url} after ${elapsedMs}ms: ${
        err instanceof Error ? err.message : String(err)
      }${collectorText ? '; serving the last successful exposition' : ''}`
    );
  } finally {
    clearTimeout(timer);
  }

  // Render the exposition *after* updating the gauge, so this scrape reports
  // this merge result rather than the previous one.
  const serverText = await serverMetrics();
  return collectorText ? mergeMetrics(serverText, collectorText) : serverText;
}
