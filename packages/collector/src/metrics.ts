import { statfsSync } from 'fs';
import { dirname, resolve } from 'path';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { log } from './logger.js';
import type {
  ElectorateFetchErrorReason,
  MetricEvent,
} from '@election-night/core/types';

/**
 * Collector-side application metrics.
 *
 * The collector owns this registry and exposes it on its health port
 * (`GET /metrics`), which Fly scrapes as a second target. The same events are
 * also published to the dashboard server over Socket.io, but only as a
 * best-effort mirror / liveness heartbeat — the server does not re-register
 * them, so every series has exactly one source process.
 */
export const collectorRegister = new Registry();

const scrapeBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120];
const fetchBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export const scrapeDurationSeconds = new Histogram({
  name: 'election_scrape_duration_seconds',
  help: 'Time spent fetching and reducing one full cycle of results',
  labelNames: ['status'],
  buckets: scrapeBuckets,
  registers: [collectorRegister],
});

export const scrapeElectoratesTotal = new Counter({
  name: 'election_scrape_electorates_total',
  help: 'Electorate outcomes per cycle: fresh fetch, cached fallback, or failed',
  labelNames: ['outcome'],
  registers: [collectorRegister],
});

export const electorateFetchDurationSeconds = new Histogram({
  name: 'election_electorate_fetch_duration_seconds',
  help: 'Duration of a single electorate result fetch',
  labelNames: ['outcome'],
  buckets: fetchBuckets,
  registers: [collectorRegister],
});

export const electorateFetchErrorsTotal = new Counter({
  name: 'election_electorate_fetch_errors_total',
  help: 'Electorate result fetch failures by reason',
  labelNames: ['reason'],
  registers: [collectorRegister],
});

export const scrapeRetriedElectorates = new Gauge({
  name: 'election_scrape_retried_electorates',
  help: 'Electorates retried in the last cycle',
  registers: [collectorRegister],
});

export const votesCounted = new Gauge({
  name: 'election_votes_counted',
  help: 'Total votes counted across all electorates in the latest cycle',
  registers: [collectorRegister],
});

export const electoratesReporting = new Gauge({
  name: 'election_electorates_reporting',
  help: 'Electorates with at least one vote counted in the latest cycle',
  registers: [collectorRegister],
});

export const electoratesTotal = new Gauge({
  name: 'election_electorates_total',
  help: 'Electorates in the configured cycle',
  registers: [collectorRegister],
});

export const collectorSocketConnected = new Gauge({
  name: 'election_collector_socket_connected',
  help: 'Whether the collector is connected to the dashboard server',
  registers: [collectorRegister],
});

export const webhookPublishesTotal = new Counter({
  name: 'election_webhook_publishes_total',
  help: 'Webhook publish attempts by outcome',
  labelNames: ['status'],
  registers: [collectorRegister],
});

export const webhookPublishDurationSeconds = new Histogram({
  name: 'election_webhook_publish_duration_seconds',
  help: 'Webhook publish duration including retries',
  labelNames: ['status'],
  buckets: fetchBuckets,
  registers: [collectorRegister],
});

export const snapshotWritesTotal = new Counter({
  name: 'election_snapshot_writes_total',
  help: 'Result snapshot writes to SQLite by outcome',
  labelNames: ['status'],
  registers: [collectorRegister],
});

export const dbWriteDurationSeconds = new Histogram({
  name: 'election_db_write_duration_seconds',
  help: 'Time spent writing one result snapshot to SQLite',
  labelNames: ['status'],
  buckets: fetchBuckets,
  registers: [collectorRegister],
});

export const buildInfo = new Gauge({
  name: 'election_build_info',
  help: 'Build metadata; value is always 1',
  labelNames: ['version', 'revision'],
  registers: [collectorRegister],
});

/**
 * Size and free space of the filesystem holding the SQLite database.
 *
 * SQLite reports a full disk only when a write fails (`SQLITE_FULL`), which is
 * too late to be useful: the collector then cannot record anything, so the
 * site serves nothing and the failure is only visible as an empty page. These
 * two series are the leading indicator, and the pair is what makes it a
 * ratio rather than a magic number.
 */
export const diskSizeBytes = new Gauge({
  name: 'election_disk_size_bytes',
  help: 'Size of the filesystem holding the SQLite database',
  labelNames: ['path'],
  registers: [collectorRegister],
});

export const diskAvailableBytes = new Gauge({
  name: 'election_disk_available_bytes',
  help: 'Bytes free on the filesystem holding the SQLite database',
  labelNames: ['path'],
  registers: [collectorRegister],
});

buildInfo.set(
  {
    version: process.env.APP_VERSION ?? 'dev',
    revision: process.env.GIT_SHA ?? 'unknown',
  },
  1
);

// Start at 0 so the series exists (and alerts evaluate) before the first
// successful connection.
collectorSocketConnected.set(0);

// ---- Recording functions -------------------------------------------------
// Each returns the event to publish over Socket.io, so the caller can batch
// them into a single `publishMetrics()` call.

export function emitScrapeDuration(
  seconds: number,
  status: 'success' | 'partial' | 'error'
): MetricEvent {
  scrapeDurationSeconds.observe({ status }, seconds);
  return { metric: 'scrapeDurationSeconds', seconds, status };
}

export function emitScrapeElectorate(
  outcome: 'success' | 'error' | 'cached'
): MetricEvent {
  scrapeElectoratesTotal.inc({ outcome });
  return { metric: 'scrapeElectoratesTotal', outcome };
}

export function emitElectorateFetchDuration(
  seconds: number,
  outcome: 'success' | 'error'
): MetricEvent {
  electorateFetchDurationSeconds.observe({ outcome }, seconds);
  return { metric: 'electorateFetchDurationSeconds', seconds, outcome };
}

export function emitElectorateFetchError(
  reason: ElectorateFetchErrorReason
): MetricEvent {
  electorateFetchErrorsTotal.inc({ reason });
  return { metric: 'electorateFetchErrorsTotal', reason };
}

export function emitScrapeRetries(count: number): MetricEvent {
  scrapeRetriedElectorates.set(count);
  return { metric: 'scrapeRetriedElectorates', count };
}

export function emitVotesCounted(
  total: number,
  reporting: number,
  electorates: number
): MetricEvent {
  votesCounted.set(total);
  electoratesReporting.set(reporting);
  electoratesTotal.set(electorates);
  return { metric: 'votesCounted', total, reporting, electorates };
}

export function emitCollectorSocketConnected(connected: boolean): MetricEvent {
  collectorSocketConnected.set(connected ? 1 : 0);
  return { metric: 'collectorSocketConnected', connected };
}

export function emitWebhookPublish(status: 'success' | 'error'): MetricEvent {
  webhookPublishesTotal.inc({ status });
  return { metric: 'webhookPublishesTotal', status };
}

export function emitWebhookPublishDuration(
  seconds: number,
  status: 'success' | 'error'
): MetricEvent {
  webhookPublishDurationSeconds.observe({ status }, seconds);
  return { metric: 'webhookPublishDurationSeconds', seconds, status };
}

/** Records the snapshot-write counter and duration; returns both events. */
export function emitSnapshotWrite(
  seconds: number,
  status: 'success' | 'error'
): MetricEvent[] {
  snapshotWritesTotal.inc({ status });
  dbWriteDurationSeconds.observe({ status }, seconds);
  return [
    { metric: 'snapshotWritesTotal', status },
    { metric: 'dbWriteDurationSeconds', seconds, status },
  ];
}

/**
 * Samples the filesystem holding the database. Returns null for in-memory
 * databases (tests) and for a path that cannot be sampled — callers decide
 * what to do with an unknown value rather than being handed a fake zero.
 */
export function sampleDiskUsage(
  dbPath: string
): { path: string; size: number; available: number } | null {
  if (dbPath === ':memory:') return null;
  const path = resolve(dirname(dbPath));
  try {
    const stats = statfsSync(path);
    return {
      path,
      size: stats.blocks * stats.bsize,
      available: stats.bavail * stats.bsize,
    };
  } catch (err) {
    // A metrics sample must never take the collector down.
    log.warn(`Could not sample disk usage for ${path}:`, err);
    return null;
  }
}

/**
 * Publishes the disk sample. Called once per cycle so the value is current
 * when a write fails.
 */
export function recordDiskUsage(dbPath: string): void {
  const sample = sampleDiskUsage(dbPath);
  if (!sample) return;
  diskSizeBytes.set({ path: sample.path }, sample.size);
  diskAvailableBytes.set({ path: sample.path }, sample.available);
}
