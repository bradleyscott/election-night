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

const COLLECTOR_TIMEOUT_MS = 3_000;

export async function collectMetricsBody(): Promise<string> {
  const url = dashboardServerConfig.collectorMetricsUrl;

  if (!url) {
    // Merging is disabled (e.g. a split deployment scrapes the collector
    // directly): there is no hop to report on, so don't alarm on it.
    collectorMetricsReachable.set(1);
    return serverMetrics();
  }

  let collectorText: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`responded ${res.status}`);
    collectorText = await res.text();
    collectorMetricsReachable.set(1);
  } catch (err) {
    // Serve the server's own metrics rather than failing the whole scrape.
    collectorMetricsReachable.set(0);
    log.debug(
      `Collector metrics not merged from ${url}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    clearTimeout(timer);
  }

  // Render the exposition *after* updating the gauge, so this scrape reports
  // this merge result rather than the previous one.
  const serverText = await serverMetrics();
  return collectorText ? mergeMetrics(serverText, collectorText) : serverText;
}
