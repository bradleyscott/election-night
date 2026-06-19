import { statSync } from 'fs';
import { resolve } from 'path';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { MetricEvent } from '@election-night/core/types';
import { dashboardServerConfig } from './config.js';

export const register = new Registry();

export const websocketClients = new Gauge({
  name: 'election_websocket_clients_connected',
  help: 'Number of connected dashboard clients',
  registers: [register],
});

export const feedEventsTotal = new Counter({
  name: 'election_feed_events_total',
  help: 'Total number of feed events generated',
  labelNames: ['type'],
  registers: [register],
});

export const dbSizeBytes = new Gauge({
  name: 'election_db_size_bytes',
  help: 'Size of the SQLite database file',
  registers: [register],
});

export const lastScrapeTimestampSeconds = new Gauge({
  name: 'election_last_scrape_timestamp_seconds',
  help: 'Unix timestamp of the last received scrape update',
  registers: [register],
});

export const scrapeDurationSeconds = new Histogram({
  name: 'election_scrape_duration_seconds',
  help: 'Time spent scraping election results',
  labelNames: ['status'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const scrapeElectoratesTotal = new Counter({
  name: 'election_scrape_electorates_total',
  help: 'Total number of electorate pages scraped',
  labelNames: ['status'],
  registers: [register],
});

export const collectorSocketConnected = new Gauge({
  name: 'election_collector_socket_connected',
  help: 'Whether the collector is connected to the dashboard server',
  registers: [register],
});

export const webhookPublishesTotal = new Counter({
  name: 'election_webhook_publishes_total',
  help: 'Total number of webhook publish attempts',
  labelNames: ['status'],
  registers: [register],
});

let lastCollectorMetricsAt = 0;
const COLLECTOR_METRICS_STALE_MS = 60_000;

export function applyMetricEvents(events: MetricEvent | MetricEvent[]): void {
  const arr = Array.isArray(events) ? events : [events];
  for (const event of arr) {
    switch (event.metric) {
      case 'scrapeDurationSeconds':
        scrapeDurationSeconds.observe({ status: event.status }, event.seconds);
        break;
      case 'scrapeElectoratesTotal':
        scrapeElectoratesTotal.inc({ status: event.status });
        break;
      case 'collectorSocketConnected':
        collectorSocketConnected.set(event.connected ? 1 : 0);
        break;
      case 'webhookPublishesTotal':
        webhookPublishesTotal.inc({ status: event.status });
        break;
    }
  }
  lastCollectorMetricsAt = Date.now();
}

export async function metricsResponse(): Promise<string> {
  if (Date.now() - lastCollectorMetricsAt > COLLECTOR_METRICS_STALE_MS) {
    collectorSocketConnected.set(0);
  }

  try {
    dbSizeBytes.set(statSync(resolve(dashboardServerConfig.dbPath)).size);
  } catch {
    dbSizeBytes.set(0);
  }

  return register.metrics();
}
