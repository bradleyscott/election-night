# Observability and Grafana dashboards

Reference for the application-tier metrics this system exposes, how they measure
up against Prometheus/Grafana best practice, and the dashboards and alerts built
on top of them.

**Scope: application tier only.** Machine and runtime signals (CPU, memory, disk,
network, file descriptors, volume usage, OOM exits, edge/app HTTP) are published
by Fly.io automatically and are deliberately **not** re-instrumented — see §7.
This document is about what only the application can know: collector cycles,
feed freshness, socket delivery, history-API behaviour, webhooks, and count
progress.

The system runs as one Fly.io app with two processes: the dashboard server
(public, `:3456`) and the collector (loopback, `:3459`). Each owns a Prometheus
registry; Fly scrapes the server's endpoint, which merges the collector's.

## 1. Current instrumentation

Two registries, so no series has two sources.

**Dashboard server** — `packages/dashboard/server/metrics.ts`, served on
`:3456` (the single Fly scrape target):

| Metric                                                       | Type      | Labels                           |
| ------------------------------------------------------------ | --------- | -------------------------------- |
| `election_websocket_clients_connected`                       | Gauge     | —                                |
| `election_feed_events_total`                                 | Counter   | `type`                           |
| `election_feed_events_stored`                                | Gauge     | —                                |
| `election_last_scrape_timestamp_seconds`                     | Gauge     | —                                |
| `election_collector_metrics_last_received_timestamp_seconds` | Gauge     | —                                |
| `election_collector_metrics_reachable`                       | Gauge     | —                                |
| `election_socket_messages_total`                             | Counter   | `direction`, `event`             |
| `election_http_requests_total`                               | Counter   | `method`, `route`, `status_code` |
| `election_http_request_duration_seconds`                     | Histogram | `method`, `route`                |
| `election_history_upstream_requests_total`                   | Counter   | `route`, `outcome`               |
| `election_history_upstream_request_duration_seconds`         | Histogram | `route`                          |
| `election_history_cache_events_total`                        | Counter   | `result`                         |
| `election_build_info`                                        | Gauge     | `version`, `revision`            |

**Collector** — `packages/collector/src/metrics.ts`, served on `:3459` and
merged into the server's `/metrics` (see below):

| Metric                                       | Type      | Labels                |
| -------------------------------------------- | --------- | --------------------- |
| `election_scrape_duration_seconds`           | Histogram | `status`              |
| `election_scrape_electorates_total`          | Counter   | `outcome`             |
| `election_electorate_fetch_duration_seconds` | Histogram | `outcome`             |
| `election_electorate_fetch_errors_total`     | Counter   | `reason`              |
| `election_scrape_retried_electorates`        | Gauge     | —                     |
| `election_votes_counted`                     | Gauge     | —                     |
| `election_electorates_reporting`             | Gauge     | —                     |
| `election_electorates_total`                 | Gauge     | —                     |
| `election_collector_socket_connected`        | Gauge     | —                     |
| `election_webhook_publishes_total`           | Counter   | `status`              |
| `election_webhook_publish_duration_seconds`  | Histogram | `status`              |
| `election_snapshot_writes_total`             | Counter   | `status`              |
| `election_db_write_duration_seconds`         | Histogram | `status`              |
| `election_build_info`                        | Gauge     | `version`, `revision` |

Bounded label values:

- `outcome` (electorates): `success` | `cached` | `error`.
- `status` (cycles, webhooks, DB): `success` | `partial` | `error` as applicable.
- `reason` (fetch errors): `timeout` | `http` | `parse` | `network`.
- `route` is always a route template (`/api/history/electorate/:name`), never a
  raw path — see `packages/dashboard/server/routes.ts`.
- `direction`/`event` (socket messages): `in|out` and a small fixed event set.

Histogram buckets are `0.05…120s` for cycles and `0.005…5s` for fetches,
webhooks and DB writes.

**How the two processes connect.** Fly scrapes exactly one metrics endpoint per
process — multiple `[[metrics]]` sections in `fly.toml` only apply across Fly
_process groups_, which are separate Machines
([community.fly.io/t/26251](https://community.fly.io/t/multiple-metrics-entries-without-process-groups/26251)).
So `GET /metrics` on the server pulls the collector's exposition over loopback
(`COLLECTOR_METRICS_URL`, default `<HISTORY_UPSTREAM>/metrics`,
`packages/dashboard/server/collector-metrics.ts`) and appends it, dropping the
collector's duplicate `election_build_info` family so the body has one HELP/TYPE
line per family. `election_collector_metrics_reachable` is 1 when that merge
succeeded on the last scrape and 0 otherwise; if the collector is unreachable
the endpoint still serves the server's own series.

The collector also publishes each event over Socket.io, but only as a
best-effort heartbeat: the server records receipt as
`election_collector_metrics_last_received_timestamp_seconds` and does **not**
re-register the series.

## 2. Best practices this assessment uses

**Naming** ([Prometheus metric and label naming](https://prometheus.io/docs/practices/naming/), [Robust Perception](https://www.robustperception.io/on-the-naming-of-things/))

- Single-word application prefix (`election_`) — ✅.
- One unit and one quantity per metric; base units (seconds, bytes), plural unit suffix — ✅.
- Counters end in `_total`; timestamps use `..._timestamp_seconds` — ✅.
- Labels, not name segments, carry dimensions — ✅.
- snake_case, no colons, no metric type in the name — ✅.
- Same label name means the same thing everywhere — ✅ (`outcome` is now
  distinct from cycle `status`).

**Labels and cardinality** ([Prometheus data model](https://prometheus.io/docs/concepts/data_model/))

- Every label combination is a time series. Keep values bounded and small.
- Never put user input or unbounded identifiers in labels; label with the
  **route template** for HTTP.
- Don't define `app`, `region`, `host` or `instance` yourself: Fly adds them to
  every custom series (and overwrites yours if you use the same names).
- Either `sum()` or `avg()` across all dimensions should be a meaningful number.

**Metric types** ([Prometheus histogram practices](https://prometheus.io/docs/practices/histograms/))

- Counters for monotonic event counts; gauges for point-in-time values.
- Histograms over summaries when you need to aggregate across instances or
  compute arbitrary quantiles.

**Stay in your lane** ([Fly.io metrics](https://fly.io/docs/monitoring/metrics/))

- The platform owns machine/runtime telemetry (`fly_instance_*`, `fly_volume_*`,
  `fly_instance_exit_*`). The app owns domain telemetry. Don't emit
  `process_*`/`nodejs_*` duplicates; do emit the things only the app knows.

**Dashboard design** ([Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/))

- A dashboard should answer one question and tell a story (general → specific).
- Pick a strategy: **RED** (Rate, Errors, Duration) for the service surface, and
  **USE** (Utilization, Saturation, Errors) for the machine. Alert on RED
  (symptoms), diagnose with USE (causes).
- Use template variables instead of dashboard copies; version-control the JSON.
- Don't stack unless the parts genuinely sum; set units; set thresholds; add a
  panel description; link alerts to the dashboard.
- Avoid dashboard sprawl and needless auto-refresh (the poll interval is 120s —
  a 30s refresh is more than enough).

**PromQL** ([histogram_quantile](https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile), [Grafana `$__rate_interval`](https://grafana.com/blog/new-in-grafana-7-2-rate-interval-for-prometheus-rate-queries-that-just-work/))

- `rate()`/`increase()` windows must be ≥ 4× the scrape interval. Fly scrapes
  every 15s, so 60s is the floor; the dashboards use `$__rate_interval`. (The
  Fly endpoint is VictoriaMetrics, whose `rate()` is more forgiving, but the
  dashboards stay portable by not relying on that.)
- `histogram_quantile()` needs `by (le)`, and `rate()` must be applied to the
  `_bucket` series **before** aggregating.
- Never average pre-computed quantiles.

## 3. Assessment

### 3.1 What follows best practice

- **Naming and units.** `election_` namespace, base unit seconds, `_total` on
  counters, `..._timestamp_seconds` for timestamps.
- **Histograms, not summaries**, so quantiles aggregate across instances.
- **Bounded labels everywhere**; HTTP uses route templates, not raw paths.
- **Single source per series.** The collector owns pipeline metrics, the server
  owns delivery metrics, and Fly owns machine metrics.
- **Business signal present.** `election_votes_counted` and
  `election_electorates_reporting` answer "is the count advancing?" directly.

### 3.2 Gaps found, and how they were resolved

| Severity | Gap                                                           | Resolution                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Collector metrics were pushed and lossy; it had no `/metrics` | The collector owns a registry and serves `/metrics` on `:3459`. Fly scrapes only one endpoint per process, so the server's `/metrics` merges it over loopback (`election_collector_metrics_reachable` tracks that hop). The Socket.io push is now a heartbeat mirror only. |
| P0       | No progress/datasource gauges                                 | `election_votes_counted`, `election_electorates_reporting`, `election_electorates_total` are emitted every cycle.                                                                                                                                                          |
| P1       | No history-upstream or cache metrics                          | `election_history_upstream_requests_total{route,outcome}`, `..._duration_seconds{route}` and `election_history_cache_events_total{result}`; `outcome="stale_served"` is the app-tier signal that the collector became unreachable.                                         |
| P1       | No per-route HTTP metrics                                     | `election_http_requests_total` and `election_http_request_duration_seconds`, labelled with route templates via `routes.ts`.                                                                                                                                                |
| P1       | Staleness was inferred by a hard-coded 60s hack               | Replaced by `election_collector_metrics_last_received_timestamp_seconds`, updated on every collector heartbeat; alert on its age.                                                                                                                                          |
| P1       | The `status` label meant two different things                 | Electorate fetches now use `outcome` (`success`/`cached`/`error`); only cycle/webhook/DB metrics use `status`.                                                                                                                                                             |
| P1       | No per-electorate fetch latency or error reason               | `election_electorate_fetch_duration_seconds{outcome}` and `election_electorate_fetch_errors_total{reason}`, plus `election_scrape_retried_electorates`.                                                                                                                    |
| P2       | Histogram buckets had nothing below 500ms                     | Cycle buckets now `0.05…120s`; fetch/webhook/DB buckets `0.005…5s`.                                                                                                                                                                                                        |
| P2       | No build/version metric                                       | `election_build_info{version,revision}` on both processes, fed by `APP_VERSION` / `GIT_SHA` at build time.                                                                                                                                                                 |
| P2       | Feed retention was unobservable                               | `election_feed_events_stored`, to compare against `MAX_FEED_EVENTS`.                                                                                                                                                                                                       |
| P2       | No committed dashboards                                       | `ops/grafana/` holds three generator-built dashboards plus provisioning.                                                                                                                                                                                                   |

### 3.3 Still open

- **Grafana alert rules are defined but not provisioned as code** (§6). Fly's
  managed Prometheus is query-only (no recording rules) and has no alerting, and
  contact points are deployment-specific, so the rules are applied in Grafana.
- **Per-electorate metric series are deliberately not labelled by electorate.**
  Cardinality is bounded (~71) but the labels buy little over the aggregate, and
  per-electorate detail is better served by the SQLite history API.
- **No tracing.** This is a two-process system with one HTTP hop; latency
  histograms on both sides cover it without a tracing stack.

## 4. Implementation notes

The scope split is the load-bearing decision: one series, one owner.

```
dashboard server (:3456)  ─┐
  HTTP, sockets, feed,     │
  history upstream,        ├─► Fly managed Prometheus ─► Grafana
  collector liveness       │
collector (:3459)         ─┘
  cycles, fetches, counts,
  webhooks, SQLite writes
```

- `packages/core/src/types.ts` — `MetricEvent` union (the Socket.io mirror) plus
  `ElectorateFetchErrorReason`.
- `packages/collector/src/metrics.ts` — collector registry, metric definitions,
  and `emit*` functions that record locally and return the event to publish.
- `packages/collector/src/health.ts` — serves `GET /metrics` and returns the
  server handle (so it can be closed in tests).
- `packages/collector/src/scrape-cycle.ts` — per-fetch duration/error
  classification (`classifyFetchError`), retry count, and votes/reporting gauges.
- `packages/collector/src/results.ts`, `index.ts` — webhook duration and
  snapshot-write/db-write timing.
- `packages/dashboard/server/collector-metrics.ts` — pulls and merges the
  collector exposition into `GET /metrics` (the single Fly scrape target).
- `packages/dashboard/server/metrics.ts` — server registry,
  `noteCollectorHeartbeat()`, `mergeMetrics()`.
- `packages/dashboard/server/config.ts` — `COLLECTOR_METRICS_URL`, derived from
  `HISTORY_UPSTREAM` by default.
- `packages/dashboard/server/routes.ts` — bounded route labels.
- `packages/dashboard/server/index.ts` — HTTP timing on `res.on('finish')` and
  socket message counters.
- `packages/dashboard/server/history-upstream.ts` — upstream/cache instrumentation.
- `packages/dashboard/server/feed.ts` — stored-events gauge.
- `fly.toml` — the single `[metrics]` scrape target (`:3456`).
- `ops/grafana/` — dashboards, generator and provisioning.

## 5. Grafana dashboards

Committed under `ops/grafana/dashboards/` and generated from
`ops/grafana/build-dashboards.mjs` (edit the generator, not the JSON):

| Dashboard                             | UID                        | Answers                                        |
| ------------------------------------- | -------------------------- | ---------------------------------------------- |
| Election Night — Overview             | `election-night-overview`  | Is the pipeline alive and the count advancing? |
| Election Night — Collector & Pipeline | `election-night-collector` | Which stage is slow or failing?                |
| Election Night — Live Delivery & API  | `election-night-api`       | Are browsers being served, and how fast?       |

Conventions: 30s refresh, a single `ds` data-source variable, thresholds on the
panels that map to alerts, a description on every panel, and cross-links between
the three dashboards. Dashboard 3 leads with Fly's edge RED (external truth)
before the app's per-route detail; Dashboard 1 includes Fly memory headroom as
saturation context. See `ops/grafana/README.md` for import instructions.

Panel-level mapping to metrics (all series from §1):

- **Overview** — pipeline age (`last_scrape_timestamp_seconds`), collector
  socket state, reporting share, votes counted, cycles/min, outcome ratios,
  fetch outcomes, error ratio, feed events by type, clients, memory headroom.
- **Collector & Pipeline** — cycle p50/p95/p99 (overall and by status), cycles
  completed, per-fetch p50/p95, failures by reason, retried electorates,
  cached-vs-fresh share, snapshot writes + p95 write duration, volume used,
  webhook rate, webhook failure ratio + p95 latency.
- **Live Delivery & API** — edge request rate/status and p95, request rate and
  p95 by route, app 5xx ratio, history upstream p95, cache outcomes, stale
  serves, socket messages by event, feed events stored, ready failures, clients.

## 6. Alerting

Alert on symptoms (the RED view), not causes. `$POLL` below is the configured
`POLL_INTERVAL_MS` (default 120s); substitute it into the duration and
thresholds. Fly provides no built-in alerting, so these run as Grafana alert
rules against the Fly Prometheus data source (§7).

| Alert                             | Expression                                                                                                                                         | For | Severity |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------- |
| Pipeline stalled                  | `time() - election_last_scrape_timestamp_seconds > 3 * $POLL` OR `time() - election_collector_metrics_last_received_timestamp_seconds > 3 * $POLL` | 2m  | critical |
| Collector disconnected            | `election_collector_socket_connected == 0`                                                                                                         | 5m  | critical |
| Collector metrics merge failing   | `election_collector_metrics_reachable == 0`                                                                                                        | 5m  | warning  |
| Electorate fetch error ratio high | `sum(rate(election_scrape_electorates_total{outcome="error"}[10m])) / sum(rate(election_scrape_electorates_total[10m])) > 0.1`                     | 10m | warning  |
| Data going stale (serving cache)  | `sum(rate(election_scrape_electorates_total{outcome="cached"}[10m])) > 0`                                                                          | 15m | warning  |
| Cycle duration p95 high           | `histogram_quantile(0.95, sum by (le) (rate(election_scrape_duration_seconds_bucket[15m]))) > 60`                                                  | 15m | warning  |
| Webhook failures                  | `sum(rate(election_webhook_publishes_total{status="error"}[10m])) / sum(rate(election_webhook_publishes_total[10m])) > 0.5`                        | 10m | warning  |
| History upstream failing          | `sum(rate(election_history_upstream_requests_total{outcome!="ok"}[10m])) > 0`                                                                      | 5m  | warning  |
| API 5xx ratio                     | `sum(rate(election_http_requests_total{status_code=~"5.."}[5m])) / sum(rate(election_http_requests_total[5m])) > 0.01`                             | 5m  | critical |
| Ready failing                     | `increase(election_http_requests_total{route="/ready", status_code="503"}[5m]) > 0`                                                                | 5m  | critical |
| No clients during a live window   | `election_websocket_clients_connected == 0` (time-boxed, election night only)                                                                      | 10m | info     |

Machine-tier alerts are out of scope here but trivially available from the same
data source: `fly_instance_exit_oom == 1` (OOM kill),
`rate(fly_instance_cpu_throttle[5m]) > 0` (CPU throttling), and memory headroom
from Dashboard 1.

Symptom-first rule of thumb from Grafana's guidance: "USE tells you how happy
your machines are, RED tells you how happy your users are" — page on RED, use
Fly's machine dashboards to find the cause.

## 7. Fly.io platform metrics and provisioning

Fly.io already runs the collection tier, so there is no Prometheus to deploy and
no scrape config to write.

- **Scraping is automatic, but one endpoint per process.** Fly scrapes the
  `[metrics]` section of `fly.toml` (`:3456`) every 15s into its managed
  Prometheus (VictoriaMetrics-backed). Multiple `[[metrics]]` sections are only
  honoured across Fly _process groups_ (separate Machines), which is why the
  collector's registry is merged into that one endpoint rather than scraped
  directly.
- **Query endpoint.** `https://api.fly.io/prometheus/<org-slug>/` with an
  `Authorization: Bearer <token>` (or `FlyV1 <token>`) header.
- **Dashboards.** A preconfigured Grafana instance lives at
  [fly-metrics.net](https://fly-metrics.net) with the Prometheus data source and
  the standard Fly dashboards already imported. The three application
  dashboards in `ops/grafana/` import there (or into any Grafana pointing at the
  query endpoint).
- **Retention and limits.** ~15 days, a 16MB cap on the metrics endpoint
  response, and high-cardinality custom metrics may be dropped. The endpoint is
  query-only: **recording rules cannot be added**, so keep expressions inline in
  dashboards (or run your own Prometheus that federates from it).
- **Alerting.** None built in — use Grafana alerting on the Fly data source
  (§6), or your own Alertmanager.

Machine/runtime scope that this document deliberately does not re-implement:

| Concern                       | Fly series                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| CPU, load, throttling, bursts | `fly_instance_cpu`, `fly_instance_load_average`, `fly_instance_cpu_throttle`, `fly_instance_cpu_baseline` |
| Memory                        | `fly_instance_memory_mem_total/_mem_available/_mem_free`                                                  |
| OOM / crash exits             | `fly_instance_exit_code`, `fly_instance_exit_oom`, `fly_instance_up`                                      |
| Disk / filesystem             | `fly_instance_disk_*`, `fly_instance_filesystem_*`                                                        |
| Network                       | `fly_instance_net_recv_*`, `fly_instance_net_sent_*`                                                      |
| File descriptors              | `fly_instance_filefd_allocated`, `fly_instance_filefd_maximum`                                            |
| Volume (SQLite + caches)      | `fly_volume_size_bytes`, `fly_volume_used_pct`                                                            |
| External HTTP (edge)          | `fly_edge_http_responses_count`, `fly_edge_http_response_time_seconds`                                    |
| App proxy HTTP                | `fly_app_http_responses_count`, `fly_app_http_response_time_seconds`, `fly_app_concurrency`               |

## Sources

- [Prometheus: Metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Prometheus: Data model](https://prometheus.io/docs/concepts/data_model/)
- [Prometheus: Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Prometheus: Query functions (`histogram_quantile`)](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- [Robust Perception: On the naming of things](https://www.robustperception.io/on-the-naming-of-things/)
- [Grafana: Dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/)
- [Grafana: `$__rate_interval`](https://grafana.com/blog/new-in-grafana-7-2-rate-interval-for-prometheus-rate-queries-that-just-work/)
- [Fly.io: Metrics on Fly.io](https://fly.io/docs/monitoring/metrics/)
