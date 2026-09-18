import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyMetricEvents,
  feedEventsTotal,
  lastScrapeTimestampSeconds,
  metricsResponse,
  register,
  websocketClients,
} from '../../server/metrics.js';

describe('dashboard metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('applies collector metric events and exposes them in Prometheus format', async () => {
    applyMetricEvents([
      { metric: 'scrapeDurationSeconds', seconds: 1.23, status: 'success' },
      { metric: 'scrapeElectoratesTotal', status: 'success' },
      { metric: 'scrapeElectoratesTotal', status: 'fallback' },
      { metric: 'scrapeElectoratesTotal', status: 'error' },
      { metric: 'webhookPublishesTotal', status: 'success' },
    ]);

    const output = await metricsResponse();

    expect(output).toContain(
      'election_scrape_duration_seconds_sum{status="success"} 1.23'
    );
    expect(output).toContain(
      'election_scrape_duration_seconds_count{status="success"} 1'
    );
    expect(output).toContain(
      'election_scrape_electorates_total{status="success"} 1'
    );
    expect(output).toContain(
      'election_scrape_electorates_total{status="fallback"} 1'
    );
    expect(output).toContain(
      'election_scrape_electorates_total{status="error"} 1'
    );
    expect(output).toContain('election_collector_last_cycle_ok 1');
    expect(output).toContain(
      'election_webhook_publishes_total{status="success"} 1'
    );
  });

  it('tracks dashboard-only gauges directly', async () => {
    websocketClients.set(5);
    lastScrapeTimestampSeconds.set(1234567890);
    feedEventsTotal.inc({ type: 'leader_change' });
    feedEventsTotal.inc({ type: 'result_updated' });

    const output = await metricsResponse();

    expect(output).toContain('election_websocket_clients_connected 5');
    expect(output).toContain(
      'election_last_scrape_timestamp_seconds 1234567890'
    );
    expect(output).toContain(
      'election_feed_events_total{type="leader_change"} 1'
    );
    expect(output).toContain(
      'election_feed_events_total{type="result_updated"} 1'
    );
  });

  it('reports the collector as unhealthy until a cycle reports metrics', async () => {
    // Nothing has run yet: the gauge is 0 until the first metric event lands.
    // (The collector runs in-process, so there is no connection to go stale.)
    expect(await metricsResponse()).toContain(
      'election_collector_last_cycle_ok 0'
    );

    applyMetricEvents({ metric: 'scrapeDurationSeconds', seconds: 1, status: 'success' });

    expect(await metricsResponse()).toContain(
      'election_collector_last_cycle_ok 1'
    );
  });
});
