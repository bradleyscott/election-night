# Grafana dashboards

Version-controlled dashboards for the application-tier metrics. The metric
inventory, the best-practice assessment and the alert definitions live in
[`docs/observability.md`](../../docs/observability.md).

## Where the data comes from

Fly.io scrapes the metrics itself — there is no Prometheus to run — but it
scrapes **one endpoint per process**, so `fly.toml` declares a single `[metrics]`
target:

- **:3456** — the dashboard server. Its `/metrics` merges the collector's
  registry over loopback (`COLLECTOR_METRICS_URL`, default
  `<HISTORY_UPSTREAM>/metrics`) and appends it to its own HTTP, socket, feed and
  history-upstream series. Fly has no way to scrape `:3459` directly
  ([community.fly.io/t/26251](https://community.fly.io/t/multiple-metrics-entries-without-process-groups/26251)).

`election_collector_metrics_reachable` is 1 when that merge succeeded on the last
scrape and 0 otherwise, so a broken collector shows up rather than silently
dropping its series.

- The series land in Fly's managed Prometheus at
  `https://api.fly.io/prometheus/<org-slug>/` (~15 day retention). Machine
  metrics (`fly_instance_*`, `fly_edge_*`, `fly_volume_*`) are published
  automatically alongside them.

## Dashboards

| File                                                                                   | Title                                 | Answers                              |
| -------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| [`dashboards/election-night-overview.json`](dashboards/election-night-overview.json)   | Election Night — Overview             | Is the pipeline alive and advancing? |
| [`dashboards/election-night-collector.json`](dashboards/election-night-collector.json) | Election Night — Collector & Pipeline | Which stage is slow or failing?      |
| [`dashboards/election-night-api.json`](dashboards/election-night-api.json)             | Election Night — Live Delivery & API  | Are browsers being served, how fast? |

They cross-link to each other, set 30s refresh, and use a single `ds` template
variable so the same JSON works against Fly's Prometheus or a local one. The
dashboards deliberately do **not** filter on `app`/`instance` so they also work
against a local Prometheus that does not add Fly's labels.

## Editing

The JSON is generated from the panel definitions in
[`build-dashboards.mjs`](build-dashboards.mjs). Edit that file and regenerate —
do not hand-edit the JSON:

```bash
node ops/grafana/build-dashboards.mjs
```

## Importing

**Managed Grafana (fly-metrics.net):** open the [Fly metrics
dashboard](https://fly-metrics.net), then _Dashboards → New → Import_ and upload
each JSON file (or paste it). Select the preconfigured Prometheus data source
when prompted.

**Self-hosted Grafana:** mount [`provisioning/`](provisioning) and this
directory into the container. `provisioning/datasources/fly-prometheus.yml`
points at Fly's Prometheus — fill in the org slug and token, or create the data
source in the UI. `provisioning/dashboards/dashboards.yml` loads the JSON from
`/var/lib/grafana/dashboards`.

## Alerting

Fly's managed Prometheus has no alerting and is query-only (no recording
rules), so alerts run as **Grafana alert rules** against the Fly data source.
The rules are defined in `docs/observability.md` §6 and are not provisioned as
code here — contact points and notification policies are deployment-specific.
Wire them up in Grafana and link each alert to the panel that explains it.
