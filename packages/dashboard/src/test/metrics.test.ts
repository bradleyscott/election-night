import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildInfo,
  collectorMetricsLastReceived,
  collectorMetricsReachable,
  feedEventsStored,
  feedEventsTotal,
  historyCacheEvents,
  historyUpstreamDuration,
  historyUpstreamTotal,
  httpRequestDuration,
  httpRequestsTotal,
  lastScrapeTimestampSeconds,
  mergeMetrics,
  noteCollectorHeartbeat,
  register,
  serverMetrics,
  socketMessagesTotal,
  websocketClients,
} from '../../server/metrics.js';

describe('dashboard metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('exposes server-owned gauges and counters in Prometheus format', async () => {
    websocketClients.set(5);
    lastScrapeTimestampSeconds.set(1234567890);
    feedEventsStored.set(42);
    feedEventsTotal.inc({ type: 'leader_change' });
    feedEventsTotal.inc({ type: 'result_updated' });
    socketMessagesTotal.inc({ direction: 'out', event: 'feed_update' });
    httpRequestsTotal.inc({
      method: 'GET',
      route: '/api/history/snapshots',
      status_code: '200',
    });
    httpRequestDuration.observe(
      { method: 'GET', route: '/api/history/snapshots' },
      0.02
    );
    historyCacheEvents.inc({ result: 'hit' });
    historyUpstreamTotal.inc({
      route: '/history/snapshots',
      outcome: 'ok',
    });
    historyUpstreamDuration.observe({ route: '/history/snapshots' }, 0.01);
    collectorMetricsReachable.set(1);
    buildInfo.set({ version: 'test', revision: 'abc123' }, 1);

    const output = await serverMetrics();

    expect(output).toContain('election_websocket_clients_connected 5');
    expect(output).toContain(
      'election_last_scrape_timestamp_seconds 1234567890'
    );
    expect(output).toContain('election_feed_events_stored 42');
    expect(output).toContain(
      'election_feed_events_total{type="leader_change"} 1'
    );
    expect(output).toContain(
      'election_socket_messages_total{direction="out",event="feed_update"} 1'
    );
    expect(output).toContain(
      'election_http_requests_total{method="GET",route="/api/history/snapshots",status_code="200"} 1'
    );
    expect(output).toContain(
      'election_http_request_duration_seconds_count{method="GET",route="/api/history/snapshots"} 1'
    );
    expect(output).toContain(
      'election_history_cache_events_total{result="hit"} 1'
    );
    expect(output).toContain(
      'election_history_upstream_requests_total{route="/history/snapshots",outcome="ok"} 1'
    );
    expect(output).toContain(
      'election_history_upstream_request_duration_seconds_count{route="/history/snapshots"} 1'
    );
    expect(output).toContain('election_collector_metrics_reachable 1');
    expect(output).toContain(
      'election_build_info{version="test",revision="abc123"} 1'
    );
  });

  it('records the collector heartbeat timestamp on demand', async () => {
    collectorMetricsLastReceived.set(0);
    noteCollectorHeartbeat();

    const output = await serverMetrics();
    const match = output.match(
      /^election_collector_metrics_last_received_timestamp_seconds (\d+(?:\.\d+)?)$/m
    );
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(0);
  });

  it('scrapes without any collector events (no staleness side effects)', async () => {
    const output = await serverMetrics();
    expect(output).toContain('election_websocket_clients_connected');
  });

  it('does not expose collector-owned series from the server alone', async () => {
    const output = await serverMetrics();
    expect(output).not.toContain('election_scrape_duration_seconds');
    expect(output).not.toContain('election_scrape_electorates_total');
    expect(output).not.toContain('election_votes_counted');
  });
});

describe('mergeMetrics', () => {
  const serverText =
    '# HELP election_build_info Build metadata; value is always 1\n' +
    '# TYPE election_build_info gauge\n' +
    'election_build_info{version="dev",revision="abc"} 1\n' +
    '# HELP election_websocket_clients_connected Number of connected dashboard clients\n' +
    '# TYPE election_websocket_clients_connected gauge\n' +
    'election_websocket_clients_connected 3\n';

  const collectorText =
    '# HELP election_votes_counted Total votes counted\n' +
    '# TYPE election_votes_counted gauge\n' +
    'election_votes_counted 846000\n' +
    '# HELP election_build_info Build metadata; value is always 1\n' +
    '# TYPE election_build_info gauge\n' +
    'election_build_info{version="dev",revision="abc"} 1\n';

  it('appends the collector exposition to the server exposition', () => {
    const merged = mergeMetrics(serverText, collectorText);
    expect(merged).toContain('election_websocket_clients_connected 3');
    expect(merged).toContain('election_votes_counted 846000');
  });

  it('drops the collector copy of a duplicated family so Prometheus can parse it', () => {
    const merged = mergeMetrics(serverText, collectorText);
    const helpLines = merged
      .split('\n')
      .filter((l) => l.startsWith('# HELP election_build_info'));
    expect(helpLines).toHaveLength(1);
    expect(merged.match(/^election_build_info\{/gm)).toHaveLength(1);
  });

  it('returns the server exposition unchanged when the collector is empty', () => {
    expect(mergeMetrics(serverText, '')).toBe(serverText);
  });
});
