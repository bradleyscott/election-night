#!/usr/bin/env node
/**
 * Generates the Grafana dashboard JSON in ./dashboards from the panel
 * definitions below, so panels stay consistent and the JSON is not hand-edited
 * in the browser.
 *
 *   node ops/grafana/build-dashboards.mjs
 *
 * Dashboards target the Fly.io managed Prometheus data source (see
 * ../../docs/observability.md). The only template variable is `ds` (data
 * source), so the same JSON works against Fly's Prometheus or a local one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dashboards');

const RATE = '$__rate_interval';
const ds = { type: 'prometheus', uid: '${ds}' };

const green = (v) => ({ color: 'green', value: v });
const yellow = (v) => ({ color: 'yellow', value: v });
const red = (v) => ({ color: 'red', value: v });

function target(expr, legendFormat = '', refId = 'A') {
  return {
    datasource: ds,
    editorMode: 'code',
    expr,
    legendFormat,
    range: true,
    refId,
  };
}

function stat({
  title,
  description,
  expr,
  unit,
  thresholds,
  decimals = 1,
  w = 6,
  h = 5,
}) {
  return {
    title,
    description,
    type: 'stat',
    datasource: ds,
    fieldConfig: {
      defaults: {
        color: { mode: 'thresholds' },
        decimals,
        mappings: [],
        thresholds: { mode: 'absolute', steps: thresholds },
        unit,
      },
      overrides: [],
    },
    options: {
      colorMode: 'value',
      graphMode: 'area',
      justifyMode: 'auto',
      orientation: 'auto',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      textMode: 'auto',
    },
    targets: [target(expr)],
    w,
    h,
  };
}

function timeseries({
  title,
  description,
  targets,
  unit,
  thresholds,
  w = 12,
  h = 8,
  fillOpacity = 8,
  legendCalcs = [],
  spanNulls = false,
}) {
  return {
    title,
    description,
    type: 'timeseries',
    datasource: ds,
    fieldConfig: {
      defaults: {
        color: { mode: 'palette-classic' },
        custom: {
          axisBorderShow: false,
          axisCenteredZero: false,
          axisColorMode: 'text',
          axisLabel: '',
          axisPlacement: 'auto',
          barAlignment: 0,
          drawStyle: 'line',
          fillOpacity,
          gradientMode: 'none',
          hideFrom: { legend: false, tooltip: false, viz: false },
          insertNulls: false,
          lineInterpolation: 'linear',
          lineWidth: 1,
          pointSize: 5,
          scaleDistribution: { type: 'linear' },
          showPoints: 'never',
          spanNulls,
          stacking: { group: 'A', mode: 'none' },
          thresholdsStyle: { mode: thresholds ? 'dashed' : 'off' },
        },
        mappings: [],
        thresholds: {
          mode: 'absolute',
          steps: thresholds ?? [green(null)],
        },
        unit,
      },
      overrides: [],
    },
    options: {
      legend: {
        calcs: legendCalcs,
        displayMode: 'list',
        placement: 'bottom',
        showLegend: true,
      },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
    targets,
    w,
    h,
  };
}

/** Pack panels into the 24-column grid, two panels per row by default. */
function layout(panels) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return panels.map((panel) => {
    const w = panel.w ?? 12;
    const h = panel.h ?? 8;
    if (x + w > 24) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const placed = { ...panel, gridPos: { h, w, x, y } };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    if (x >= 24) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    return placed;
  });
}

const DS_VARIABLE = {
  current: {},
  hide: 0,
  includeAll: false,
  label: 'Data source',
  multi: false,
  name: 'ds',
  options: [],
  query: 'prometheus',
  refresh: 1,
  regex: '',
  skipUrlSync: false,
  type: 'datasource',
};

function dashboard({ title, uid, description, tags, panels, links, from }) {
  const withIds = layout(panels).map((panel, i) => ({ ...panel, id: i + 1 }));
  return {
    annotations: { list: [] },
    description,
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    links: links ?? [],
    panels: withIds.map(({ w, h, ...panel }) => panel),
    refresh: '30s',
    schemaVersion: 39,
    tags: ['election-night', ...(tags ?? [])],
    templating: { list: [DS_VARIABLE] },
    time: { from: from ?? 'now-6h', to: 'now' },
    timepicker: {},
    timezone: 'browser',
    title,
    uid,
    version: 1,
    weekStart: '',
  };
}

const LINKS = [
  {
    asDropdown: false,
    icon: 'external link',
    includeVars: true,
    keepTime: true,
    tags: [],
    targetBlank: false,
    title: 'Overview',
    tooltip: '',
    type: 'link',
    url: '/d/election-night-overview',
  },
  {
    asDropdown: false,
    icon: 'external link',
    includeVars: true,
    keepTime: true,
    tags: [],
    targetBlank: false,
    title: 'Collector & Pipeline',
    tooltip: '',
    type: 'link',
    url: '/d/election-night-collector',
  },
  {
    asDropdown: false,
    icon: 'external link',
    includeVars: true,
    keepTime: true,
    tags: [],
    targetBlank: false,
    title: 'Live Delivery & API',
    tooltip: '',
    type: 'link',
    url: '/d/election-night-api',
  },
];

// ---------------------------------------------------------------------------
// Dashboard 1 — Election Night Overview
// ---------------------------------------------------------------------------

const overview = dashboard({
  title: 'Election Night — Overview',
  uid: 'election-night-overview',
  description:
    'Application golden signals for the night: is the pipeline alive, is the count advancing, is anything failing? Start here and drill into Collector & Pipeline or Live Delivery & API.',
  tags: ['overview'],
  links: LINKS,
  panels: [
    stat({
      title: 'Pipeline status',
      description:
        'Age of the last results update received by the dashboard server. Green under 2 poll intervals, red past 5. Poll interval defaults to 120s.',
      expr: `time() - election_last_scrape_timestamp_seconds`,
      unit: 's',
      decimals: 0,
      thresholds: [green(null), yellow(240), red(600)],
    }),
    stat({
      title: 'Collector connected',
      description:
        "The collector's own view of its Socket.io connection to the dashboard server (scraped from the collector).",
      expr: `max(election_collector_socket_connected)`,
      unit: 'short',
      decimals: 0,
      thresholds: [red(null), green(1)],
    }),
    stat({
      title: 'Electorates reporting',
      description:
        'Share of electorates in the cycle with at least one vote counted.',
      expr: `election_electorates_reporting / election_electorates_total`,
      unit: 'percentunit',
      thresholds: [red(null), yellow(0.5), green(0.95)],
    }),
    stat({
      title: 'Votes counted',
      description:
        'Total votes counted across all electorates, latest cycle. Formatted with locale grouping so the exact count is visible rather than abbreviated to "3M".',
      expr: `election_votes_counted`,
      unit: 'locale',
      decimals: 0,
      thresholds: [green(null)],
    }),
    timeseries({
      title: 'Scrape cycles / min',
      description: 'Completed collector cycles per minute.',
      targets: [
        target(
          `sum(rate(election_scrape_duration_seconds_count[${RATE}])) * 60`,
          'cycles/min'
        ),
      ],
      unit: 'short',
    }),
    timeseries({
      title: 'Scrape outcome ratio',
      description:
        'Cycles per second by outcome (success = every electorate fresh, partial = cache fallback used, error = nothing fetched).',
      targets: [
        target(
          `sum by (status) (rate(election_scrape_duration_seconds_count[${RATE}]))`,
          '{{status}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Electorate fetch outcomes',
      description:
        'Per-electorate outcomes per second. A rising `cached` line means results are being served from the previous poll.',
      targets: [
        target(
          `sum by (outcome) (rate(election_scrape_electorates_total[${RATE}]))`,
          '{{outcome}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Electorate error ratio',
      description: 'Failed electorate fetches as a share of all outcomes.',
      targets: [
        target(
          `sum(rate(election_scrape_electorates_total{outcome="error"}[${RATE}])) / sum(rate(election_scrape_electorates_total[${RATE}]))`,
          'error ratio'
        ),
      ],
      unit: 'percentunit',
      thresholds: [green(null), yellow(0.05), red(0.2)],
    }),
    timeseries({
      title: 'Feed events by type',
      description:
        'Generated feed events per second, by event type. Silence means the count has stopped moving.',
      targets: [
        target(
          `sum by (type) (rate(election_feed_events_total[${RATE}]))`,
          '{{type}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Connected clients',
      description: 'Browser clients connected to the dashboard server.',
      targets: [target(`election_websocket_clients_connected`, 'clients')],
      unit: 'short',
    }),
    timeseries({
      title: 'Memory headroom (Fly)',
      description:
        'Fly machine memory utilisation. Saturation context for the application; the app does not instrument this itself.',
      targets: [
        target(
          `1 - fly_instance_memory_mem_available / fly_instance_memory_mem_total`,
          'used'
        ),
      ],
      unit: 'percentunit',
      thresholds: [green(null), yellow(0.85), red(0.95)],
    }),
  ],
});

// ---------------------------------------------------------------------------
// Dashboard 2 — Collector & Data Pipeline
// ---------------------------------------------------------------------------

const collector = dashboard({
  title: 'Election Night — Collector & Pipeline',
  uid: 'election-night-collector',
  description:
    'Drill-down for "the numbers stopped moving": connect, per-cycle timing, per-electorate fetches, persistence, webhooks.',
  tags: ['collector'],
  links: LINKS,
  panels: [
    timeseries({
      title: 'Cycle duration p50 / p95 / p99',
      description: 'End-to-end duration of one fetch-and-reduce cycle.',
      targets: [
        target(
          `histogram_quantile(0.50, sum by (le) (rate(election_scrape_duration_seconds_bucket[${RATE}])))`,
          'p50'
        ),
        target(
          `histogram_quantile(0.95, sum by (le) (rate(election_scrape_duration_seconds_bucket[${RATE}])))`,
          'p95',
          'B'
        ),
        target(
          `histogram_quantile(0.99, sum by (le) (rate(election_scrape_duration_seconds_bucket[${RATE}])))`,
          'p99',
          'C'
        ),
      ],
      unit: 's',
      thresholds: [green(null), yellow(60)],
    }),
    timeseries({
      title: 'Cycle duration p95 by outcome',
      description: 'p95 cycle duration split by cycle status.',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le, status) (rate(election_scrape_duration_seconds_bucket[${RATE}])))`,
          '{{status}}'
        ),
      ],
      unit: 's',
    }),
    timeseries({
      title: 'Cycles completed',
      description: 'Completed cycles per scrape interval (rate × interval).',
      targets: [
        target(
          `sum(rate(election_scrape_duration_seconds_count[${RATE}]))`,
          'cycles/s'
        ),
        target(
          `sum(increase(election_scrape_duration_seconds_count[${RATE}]))`,
          'cycles in interval',
          'B'
        ),
      ],
      unit: 'short',
    }),
    timeseries({
      title: 'Per-electorate fetch duration',
      description:
        'Duration of a single electorate result fetch — the number that drives pacing and rate-limit decisions.',
      targets: [
        target(
          `histogram_quantile(0.50, sum by (le) (rate(election_electorate_fetch_duration_seconds_bucket[${RATE}])))`,
          'p50'
        ),
        target(
          `histogram_quantile(0.95, sum by (le) (rate(election_electorate_fetch_duration_seconds_bucket[${RATE}])))`,
          'p95',
          'B'
        ),
      ],
      unit: 's',
      thresholds: [green(null), yellow(5)],
    }),
    timeseries({
      title: 'Fetch failures by reason',
      description:
        'Failed fetches per second, bucketed by timeout / http / parse / network.',
      targets: [
        target(
          `sum by (reason) (rate(election_electorate_fetch_errors_total[${RATE}]))`,
          '{{reason}}'
        ),
      ],
      unit: 'ops',
    }),
    stat({
      title: 'Electorates retried (last cycle)',
      description: 'Size of the retry pass in the most recent cycle.',
      expr: `election_scrape_retried_electorates`,
      unit: 'short',
      decimals: 0,
      thresholds: [green(null), yellow(5), red(15)],
    }),
    timeseries({
      title: 'Cached vs fresh share',
      description:
        'Share of electorates served from the previous poll instead of a fresh fetch. Any sustained value above zero means data is going stale.',
      targets: [
        target(
          `sum(rate(election_scrape_electorates_total{outcome="cached"}[${RATE}])) / sum(rate(election_scrape_electorates_total[${RATE}]))`,
          'cached share'
        ),
      ],
      unit: 'percentunit',
      thresholds: [green(null), yellow(0.05), red(0.2)],
    }),
    timeseries({
      title: 'SQLite snapshot writes',
      description:
        'Snapshot writes per second by outcome, and the p95 write duration. The DB lives on the Fly volume.',
      targets: [
        target(
          `sum by (status) (rate(election_snapshot_writes_total[${RATE}]))`,
          'writes/s {{status}}'
        ),
        target(
          `histogram_quantile(0.95, sum by (le) (rate(election_db_write_duration_seconds_bucket[${RATE}])))`,
          'p95 duration',
          'B'
        ),
      ],
      unit: 'short',
    }),
    timeseries({
      title: 'Volume used',
      description:
        'Fly volume utilisation for the SQLite DB and caches (platform metric).',
      targets: [target(`fly_volume_used_pct`, '{{app}}')],
      unit: 'percent',
      thresholds: [green(null), yellow(80), red(95)],
    }),
    timeseries({
      title: 'Webhook publishes',
      description: 'Webhook publish attempts per second, by outcome.',
      targets: [
        target(
          `sum by (status) (rate(election_webhook_publishes_total[${RATE}]))`,
          '{{status}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Webhook failure ratio + p95 latency',
      description:
        'Failed publishes as a share of attempts, alongside p95 publish duration (including retries).',
      targets: [
        target(
          `sum(rate(election_webhook_publishes_total{status="error"}[${RATE}])) / sum(rate(election_webhook_publishes_total[${RATE}]))`,
          'failure ratio'
        ),
        target(
          `histogram_quantile(0.95, sum by (le) (rate(election_webhook_publish_duration_seconds_bucket[${RATE}])))`,
          'p95 duration',
          'B'
        ),
      ],
      unit: 'percentunit',
      thresholds: [green(null), yellow(0.5)],
    }),
  ],
});

// ---------------------------------------------------------------------------
// Dashboard 3 — Live Delivery & API
// ---------------------------------------------------------------------------

const api = dashboard({
  title: 'Election Night — Live Delivery & API',
  uid: 'election-night-api',
  description:
    "Are browsers being served, and how fast? Fly edge/app RED for external truth, plus the dashboard server's own per-route metrics and the collector history upstream.",
  tags: ['api'],
  links: LINKS,
  panels: [
    timeseries({
      title: 'Edge request rate by status',
      description: 'Fly edge responses per second by HTTP status (platform).',
      targets: [
        target(
          `sum by (status) (rate(fly_edge_http_responses_count[${RATE}]))`,
          '{{status}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Edge latency p95',
      description: 'Fly edge response time p95 — what users actually see.',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le) (rate(fly_edge_http_response_time_seconds_bucket[${RATE}])))`,
          'p95'
        ),
      ],
      unit: 's',
      thresholds: [green(null), yellow(0.5), red(2)],
    }),
    timeseries({
      title: 'Request rate by route',
      description:
        'Dashboard server requests per second, labelled by route template.',
      targets: [
        target(
          `sum by (route) (rate(election_http_requests_total[${RATE}]))`,
          '{{route}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'App 5xx ratio',
      description:
        'Responses in the 5xx class as a share of all dashboard server requests.',
      targets: [
        target(
          `sum(rate(election_http_requests_total{status_code=~"5.."}[${RATE}])) / sum(rate(election_http_requests_total[${RATE}]))`,
          '5xx ratio'
        ),
      ],
      unit: 'percentunit',
      thresholds: [green(null), yellow(0.01), red(0.05)],
    }),
    timeseries({
      title: 'Request duration p95 by route',
      description: 'Dashboard server p95 latency per route template.',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le, route) (rate(election_http_request_duration_seconds_bucket[${RATE}])))`,
          '{{route}}'
        ),
      ],
      unit: 's',
      thresholds: [green(null), yellow(0.5)],
    }),
    timeseries({
      title: 'History upstream p95',
      description:
        'p95 latency of the dashboard server calls to the collector history REST API.',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le, route) (rate(election_history_upstream_request_duration_seconds_bucket[${RATE}])))`,
          '{{route}}'
        ),
      ],
      unit: 's',
    }),
    timeseries({
      title: 'History cache outcomes',
      description:
        'Cache hits, misses and stale serves per second for history responses.',
      targets: [
        target(
          `sum by (result) (rate(election_history_cache_events_total[${RATE}]))`,
          '{{result}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Stale-on-failure serves',
      description:
        'History requests served from a stale cache because the collector was unreachable. Anything above zero means the collector is down or unreachable.',
      targets: [
        target(
          `sum(rate(election_history_upstream_requests_total{outcome="stale_served"}[${RATE}]))`,
          'stale serves'
        ),
      ],
      unit: 'ops',
      thresholds: [green(null), red(0.0001)],
    }),
    timeseries({
      title: 'Socket messages by event',
      description:
        'Socket.io messages handled by the dashboard server, by direction and event.',
      targets: [
        target(
          `sum by (direction, event) (rate(election_socket_messages_total[${RATE}]))`,
          '{{direction}} {{event}}'
        ),
      ],
      unit: 'ops',
    }),
    timeseries({
      title: 'Feed events stored',
      description:
        'Feed events retained in the server cache, against the MAX_FEED_EVENTS cap (default 200).',
      targets: [target(`election_feed_events_stored`, 'stored')],
      unit: 'short',
      thresholds: [green(null), yellow(180), red(200)],
    }),
    stat({
      title: 'Ready check failures',
      description:
        '503 responses from /ready in the selected time range (collector history upstream unreachable).',
      expr: `increase(election_http_requests_total{route="/ready", status_code="503"}[$__range])`,
      unit: 'short',
      decimals: 0,
      thresholds: [green(null), red(1)],
    }),
    stat({
      title: 'Connected clients',
      description: 'Browser clients currently connected.',
      expr: `election_websocket_clients_connected`,
      unit: 'short',
      decimals: 0,
      thresholds: [green(null)],
    }),
  ],
});

mkdirSync(outDir, { recursive: true });
for (const [name, body] of [
  ['election-night-overview.json', overview],
  ['election-night-collector.json', collector],
  ['election-night-api.json', api],
]) {
  writeFileSync(join(outDir, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote ops/grafana/dashboards/${name}`);
}
