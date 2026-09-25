import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildInfo,
  collectorRegister,
  emitCollectorSocketConnected,
  emitElectorateFetchDuration,
  emitElectorateFetchError,
  emitScrapeDuration,
  emitScrapeElectorate,
  emitScrapeRetries,
  emitSnapshotWrite,
  emitVotesCounted,
  emitWebhookPublish,
  emitWebhookPublishDuration,
  recordDiskUsage,
} from './metrics.js';

describe('collector metric events', () => {
  beforeEach(() => {
    collectorRegister.resetMetrics();
  });

  it('emits scrape duration events', () => {
    expect(emitScrapeDuration(2.5, 'partial')).toEqual({
      metric: 'scrapeDurationSeconds',
      seconds: 2.5,
      status: 'partial',
    });
  });

  it('emits electorate outcome events', () => {
    expect(emitScrapeElectorate('error')).toEqual({
      metric: 'scrapeElectoratesTotal',
      outcome: 'error',
    });
    expect(emitScrapeElectorate('cached')).toEqual({
      metric: 'scrapeElectoratesTotal',
      outcome: 'cached',
    });
  });

  it('emits socket connection events', () => {
    expect(emitCollectorSocketConnected(true)).toEqual({
      metric: 'collectorSocketConnected',
      connected: true,
    });
  });

  it('emits webhook publish events', () => {
    expect(emitWebhookPublish('success')).toEqual({
      metric: 'webhookPublishesTotal',
      status: 'success',
    });
  });

  it('emits per-fetch duration and error events', () => {
    expect(emitElectorateFetchDuration(0.25, 'success')).toEqual({
      metric: 'electorateFetchDurationSeconds',
      seconds: 0.25,
      outcome: 'success',
    });
    expect(emitElectorateFetchError('timeout')).toEqual({
      metric: 'electorateFetchErrorsTotal',
      reason: 'timeout',
    });
  });

  it('emits retry, progress and snapshot-write events', () => {
    expect(emitScrapeRetries(3)).toEqual({
      metric: 'scrapeRetriedElectorates',
      count: 3,
    });
    expect(emitVotesCounted(1000, 60, 71)).toEqual({
      metric: 'votesCounted',
      total: 1000,
      reporting: 60,
      electorates: 71,
    });
    expect(emitWebhookPublishDuration(0.4, 'error')).toEqual({
      metric: 'webhookPublishDurationSeconds',
      seconds: 0.4,
      status: 'error',
    });
    expect(emitSnapshotWrite(0.05, 'success')).toEqual([
      { metric: 'snapshotWritesTotal', status: 'success' },
      { metric: 'dbWriteDurationSeconds', seconds: 0.05, status: 'success' },
    ]);
  });

  it('records everything in the collector registry for scraping', async () => {
    emitScrapeDuration(2.5, 'success');
    emitScrapeElectorate('cached');
    emitElectorateFetchDuration(0.2, 'success');
    emitElectorateFetchError('timeout');
    emitScrapeRetries(3);
    emitVotesCounted(1000, 60, 71);
    emitWebhookPublishDuration(0.4, 'success');
    emitSnapshotWrite(0.05, 'success');
    buildInfo.set({ version: 'test', revision: 'abc123' }, 1);

    const output = await collectorRegister.metrics();

    expect(output).toContain(
      'election_scrape_duration_seconds_count{status="success"} 1'
    );
    expect(output).toContain(
      'election_scrape_electorates_total{outcome="cached"} 1'
    );
    expect(output).toContain(
      'election_electorate_fetch_duration_seconds_count{outcome="success"} 1'
    );
    expect(output).toContain(
      'election_electorate_fetch_errors_total{reason="timeout"} 1'
    );
    expect(output).toContain('election_scrape_retried_electorates 3');
    expect(output).toContain('election_votes_counted 1000');
    expect(output).toContain('election_electorates_reporting 60');
    expect(output).toContain('election_electorates_total 71');
    expect(output).toContain(
      'election_webhook_publish_duration_seconds_count{status="success"} 1'
    );
    expect(output).toContain(
      'election_snapshot_writes_total{status="success"} 1'
    );
    expect(output).toContain(
      'election_build_info{version="test",revision="abc123"} 1'
    );
  });

  it('tracks socket connectivity as a gauge', async () => {
    emitCollectorSocketConnected(true);
    expect(await collectorRegister.metrics()).toContain(
      'election_collector_socket_connected 1'
    );

    emitCollectorSocketConnected(false);
    expect(await collectorRegister.metrics()).toContain(
      'election_collector_socket_connected 0'
    );
  });
});

describe('disk usage metric', () => {
  beforeEach(() => {
    collectorRegister.resetMetrics();
  });

  async function diskValues() {
    const series = await collectorRegister.getMetricsAsJSON();
    return {
      size: series.find((s) => s.name === 'election_disk_size_bytes')?.values ?? [],
      free:
        series.find((s) => s.name === 'election_disk_available_bytes')?.values ??
        [],
    };
  }

  it('exposes size and free space for the database volume as a ratio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'en-metrics-'));
    recordDiskUsage(join(dir, 'election_results.db'));

    const { size, free } = await diskValues();
    const sampled = size.find((v) => v.labels.path === dir);
    const sampledFree = free.find((v) => v.labels.path === dir);

    expect(sampled?.value).toBeGreaterThan(0);
    expect(sampledFree?.value).toBeGreaterThanOrEqual(0);
    expect(sampledFree?.value).toBeLessThan(sampled?.value as number);
  });

  it('skips in-memory databases, which have no volume to run out of', async () => {
    const before = await diskValues();
    recordDiskUsage(':memory:');
    expect(await diskValues()).toEqual(before);
  });

  it('never throws when the path cannot be sampled', async () => {
    const before = await diskValues();
    expect(() =>
      recordDiskUsage('/nonexistent-volume-xyz/db.sqlite')
    ).not.toThrow();
    expect(await diskValues()).toEqual(before);
  });
});
