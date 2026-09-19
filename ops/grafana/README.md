# Grafana dashboards

Version-controlled dashboards for the application-tier metrics. The metric
inventory, the best-practice assessment and the alert definitions live in
[`docs/observability.md`](../../docs/observability.md).

## Where the data comes from

Fly.io scrapes the metrics itself — there is no Prometheus to run:

- `fly.toml` declares two `[[metrics]]` targets, both every 15s:
  - **:3456** — dashboard server metrics (HTTP, sockets, feed, history upstream,
    collector liveness).
  - **:3459** — collector metrics (scrape cycles, per-electorate fetches,
    webhooks, SQLite writes, count progress).
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
