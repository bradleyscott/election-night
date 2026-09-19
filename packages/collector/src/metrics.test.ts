import { describe, it, expect, beforeEach } from 'vitest';
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
