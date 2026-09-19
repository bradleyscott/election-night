![Election Night Logo](./packages/dashboard/public/favicon.svg)

# Election Night — NZ General Election Result Tracker

This started as a project for a 2023 election night party — the goal was to avoid manual data entry for a "guess the result" game. It's since grown into a full real-time election night results platform that reads the NZ Electoral Commission's official XML results feed, calculates seat projections, and serves an interactive dashboard.

## Features

- **Official results feed** — Reads the Electoral Commission's XML results feed ([electionresults.govt.nz](https://electionresults.govt.nz/)) over plain HTTPS as results are published. No browser and no Cloudflare workarounds. The election year is configurable via `ELECTION_YEAR` (e.g. `2020`, `2023`, `2026`).
- **Race calling** — Predicts winners per electorate with confidence levels (`too-close`, `leaning`, `likely`, `projected`) using statistical margin analysis.
- **Seat projections** — Allocates list seats via the Sainte-Laguë method to project the final parliament makeup.
- **Interactive web dashboard** — Built with React, Vite, Leaflet, Recharts, and Tailwind, dressed as a printed-edition newsroom broadsheet (see `design.md`). Includes:
  - Parliament seat grid and party vote breakdown
  - Electorate list with map, search, and per-electorate detail pages
  - "Close Calls" view
  - Live feed / commentary timeline
  - Trends page with historical charts
- **Real-time** — Socket.io broadcasts results from the collector to all connected web clients instantly.
- **Metrics** — both processes expose application-tier Prometheus metrics (`GET /metrics`): the dashboard server covers scrape freshness, socket delivery, feed state and the history API; the collector covers per-cycle timing, per-electorate fetch outcomes, webhooks and count progress. Fly.io scrapes both and adds machine metrics. Grafana dashboards are version-controlled in `ops/grafana/`; see [`docs/observability.md`](docs/observability.md) for the inventory, the best-practice assessment, and the dashboard and alert specs.
- **History API** — Electorate and party-vote history endpoints, served by the dashboard server from the collector's history REST API over HTTP (the server itself never opens a database).
- **Webhook notifications** — Configurable webhooks for new predictions, updated results, and leader changes (e.g., smart home integrations). A built-in webhook logger is available for local testing.
- **Persistence** — SQLite database via Drizzle ORM caches results for crash recovery and historical tracking; JSON caches and feed events are written to disk.
- **Mock server** — A built-in mock XML feed server that serves evolving results for development and testing.
- **Custom source adapters** — Pluggable `ElectionSource` interface to adapt the collector for non-NZ elections or other feeds.

## Architecture

```
election-night/
├── packages/
│   ├── core/          # Shared types, config, reducers, XML source adapter (built to dist/)
│   ├── collector/     # Polls the XML feed, writes SQLite + mock XML server (no browser)
│   └── dashboard/     # Vite React app + Socket.io server (Leaflet, Tailwind)
├── .data/             # SQLite DB + JSON caches (auto-created at runtime)
```

**Socket.io is the backbone.** The collector acts as a Socket.io _client_; the dashboard package runs the Socket.io _server_. The server also serves the built Vite app, exposes health/metrics endpoints plus a browser-facing `/api/history/*` proxy of the collector's `/history/*` REST API, and caches the latest results to disk so a restart does not blank the dashboard.

`@election-night/core` is compiled to `dist/` and consumed as built JS; root commands run `npm run build:core` before starting the collector, server, or dashboard dev mode.

```
┌─────────────────┐  Socket.io  ┌────────────────────┐
│   Collector     │ ──────────> │  Dashboard server  │
│  XML feed poll  │  results +  │  Socket.io server  │
│   SQLite        │  feed events│  + static files    │
│  /history/*     │ <────────── │  + /api/history/*  │
└─────────────────┘  history    └────────────────────┘
                                         │
                                 broadcast to
                                         │
                                         ▼
                               ┌────────────────────┐
                               │   Browser clients   │
                               │   React + Leaflet   │
                               └────────────────────┘
```

## Quick Start

`npm install` triggers `npm run prepare`, which builds `@election-night/core`. You can also build it explicitly before running other commands.

```bash
# Install dependencies (requires build tools for better-sqlite3)
npm install

# Build the shared core package (also done by npm install / prepare)
npm run build:core

# Start the mock XML results server
npm run start:mock

# In another terminal, run the collector pointed at the mock feed
XML_FEED_BASE_URL=http://localhost:3457/ \
POLL_INTERVAL_MS=15000 \
npm run start:collector

# In a third terminal, start the web dashboard
npm run dev
# → http://localhost:5173
```

### Dev commands

| Command                                        | Description                                                    |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `npm run build:core`                           | Compile `@election-night/core` to `dist/`                      |
| `npm run dev`                                  | Start web server + Vite dev server concurrently                |
| `npm run build`                                | Build core + production dashboard bundle                       |
| `npm run start:collector`                      | Run the collector CLI                                          |
| `npm run start:server`                         | Start Socket.io / dashboard server only                        |
| `npm run start:mock`                           | Start mock election results server                             |
| `npm run clear`                                | Truncate the SQLite database and delete the JSON results cache |
| `npm run log:webhooks`                         | Start a local webhook receiver on port 3458                    |
| `node scripts/fetch-electorate-boundaries.mjs` | Re-fetch official electorate boundaries (see below)            |
| `npm test`                                     | Run Vitest test suite                                          |
| `npm run lint`                                 | ESLint all packages                                            |
| `npm run typecheck`                            | TypeScript type checking for core, collector, and dashboard    |
| `npm run fmt`                                  | Prettier format                                                |

### Electorate boundaries

The map draws electorate boundaries from
`packages/dashboard/public/boundaries/<year>/{general,maori}-electorates.geojson`,
so each election cycle keeps its own geometry. Boundaries are redrawn most
cycles — 2026 has 64 general electorates where 2023 had 65, with 10 renamed or
replaced and 11 removed — so the map picks the year whose electorate names
match the live results and warns when they cannot be reconciled. See
[`docs/2026-election-boundaries.md`](docs/2026-election-boundaries.md).

```bash
# Re-fetch the 2026 boundaries from Stats NZ (~55 m tolerance)
node scripts/fetch-electorate-boundaries.mjs --year 2026

# Coarser geometry and a smaller download (~110 m)
node scripts/fetch-electorate-boundaries.mjs --year 2026 --tolerance 0.001

# Validate without writing
node scripts/fetch-electorate-boundaries.mjs --year 2026 --check
```

The script rebuilds `public/boundaries/index.json` (the name manifest used for
year selection) after writing, and drops the geometry into the minimal shape the
map needs. Data: Stats NZ, CC BY 4.0.

### Mock server

The mock server serves a mock version of the Electoral Commission XML feed (`candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml`) that simulates an evolving election night. Point the collector at it with `XML_FEED_BASE_URL=http://localhost:3457/`. Advance stages manually, auto-step, or query the current stage:

```bash
# Auto-step every 15 seconds starting from 'early' stage
npm run start:mock -- --auto-step 15000 --stage early

# Advance stage manually
curl -X POST http://localhost:3457/advance

# Reset to the first stage
curl -X POST http://localhost:3457/reset

# Get current stage
curl http://localhost:3457/stage
```

Other flags: `--port 3457` (or `MOCK_PORT`), `--year 2023|2026` (or `MOCK_ELECTION_YEAR`), `--help`.

#### Replaying 2026

`--year 2026` replays the next cycle's electorate list: 64 general + 7 Māori electorates instead of 65 + 7, with the 2026 names (`Kapiti`, `Kenepuru`, `Glendene`, `Henderson`, `Waitākere`, `Ōtāhuhu`, `Mt Maunganui`, `East Cape`, `Wellington North`, `Wellington Bays`) and the 2023 ones gone. Māori electorates are won by Te Pāti Māori, which produces the overhang the seat maths has to absorb (the mock's 2026 cycle totals 125 seats, against 122 in 2023).

The mock's electorate list is asserted against the boundary manifest the dashboard map draws from, so a replay can never serve an electorate the map has no polygon for.

```bash
# Terminal 1 — mock backend replaying 2026
npm run start:mock -- --year 2026

# Terminal 2 — collector reading it
XML_FEED_BASE_URL=http://localhost:3457/ ELECTION_YEAR=2026 npm run start:collector

# Terminal 3 — dashboard
npm run dev
```

Set `ELECTION_YEAR=2026` too (not just the mock flag): it tags snapshots with the cycle, so the 2026 replay does not mix into 2023 history, and the dashboard's map picks the 2026 boundaries to match. Advance stages with the `curl` calls above to watch counts, predictions, and seat totals move.

## Environment Variables

| Variable                | Default                         | Description                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ELECTION_YEAR`         | `2023`                          | Election year for the XML feed; builds `https://electionresults.govt.nz/electionresults_<year>/xml/`. Also tags stored snapshots and the results cache with the cycle, so history and diffs never mix two elections.                                             |
| `XML_FEED_BASE_URL`     | —                               | Full override for the XML feed base URL (must end with `/`); takes precedence over `ELECTION_YEAR`. Point this at the mock server.                                                                                                                               |
| `POLL_INTERVAL_MS`      | `120000`                        | Time between feed polls                                                                                                                                                                                                                                          |
| `CONCURRENCY`           | `10`                            | Parallel electorate fetches                                                                                                                                                                                                                                      |
| `FETCH_TIMEOUT_MS`      | `30000`                         | Per-request HTTP timeout for XML feed fetches                                                                                                                                                                                                                    |
| `FETCH_PACING_MS`       | `300`                           | Jittered delay between electorate fetches to avoid rate-limit bursts                                                                                                                                                                                             |
| `HEALTH_PORT`           | `3459`                          | Port for the collector's health/live-state JSON endpoint and `/history/*` REST API (the dashboard server is the only client; loopback in the combined image, so rate limit it at the reverse proxy only if you expose it)                                        |
| `LOG_LEVEL`             | `3`                             | Log verbosity (0=silly, 1=trace, 2=debug, 3=info)                                                                                                                                                                                                                |
| `WS_PORT`               | `3456`                          | Socket.io server port                                                                                                                                                                                                                                            |
| `WS_URL`                | `ws://localhost:3456`           | Socket.io server URL (for the collector); loopback in the combined deployment                                                                                                                                                                                    |
| `WS_RECONNECT_DELAY_MS` | `2000`                          | Delay before reconnecting to the Socket.io server                                                                                                                                                                                                                |
| `DB_PATH`               | `.data/election_results.db`     | Collector: SQLite database path (the dashboard server never opens a DB)                                                                                                                                                                                          |
| `RESULTS_CACHE_PATH`    | `.data/electorate_results.json` | Collector: JSON cache of the current cycle's electorate results, used as the webhook diff baseline. Tagged with `ELECTION_YEAR` — a cache from another cycle is ignored rather than diffed against. In the combined image this is the same file as `CACHE_PATH`. |
| `ELECTION_SOURCE_PATH`  | —                               | Path to a custom source adapter module implementing `ElectionSource`                                                                                                                                                                                             |
| `WEBHOOK_URL`           | —                               | Single webhook URL for all events. Payload includes an `event` field (`result_updated`, `prediction_changed`, `leader_change`, or `count_completed`) plus the full electorate result and a `diff` describing what changed.                                       |
| `WEBHOOK_LOG_PORT`      | `3458`                          | Port for the local `npm run log:webhooks` receiver                                                                                                                                                                                                               |
| `MOCK_PORT`             | `3457`                          | Port for the mock XML feed server                                                                                                                                                                                                                                |
| `MOCK_ELECTION_YEAR`    | `2023`                          | Mock server: which cycle's electorate list to replay (`2023` or `2026`). Overridden by `--year`.                                                                                                                                                                 |
| `COLLECTOR_ENABLED`     | `true`                          | Combined image only: set `false` to run the dashboard server without the collector (PR previews do this)                                                                                                                                                         |
| `CACHE_PATH`            | `.data/electorate_results.json` | Dashboard server JSON cache path                                                                                                                                                                                                                                 |
| `FEED_CACHE_PATH`       | `.data/feed_events.json`        | Dashboard server feed-events cache path                                                                                                                                                                                                                          |
| `MAX_FEED_EVENTS`       | `200`                           | Maximum feed events retained by the dashboard server                                                                                                                                                                                                             |
| `CLEAR_TOKEN`           | —                               | Dashboard server: when set, `POST /api/clear` requires this value in the `x-clear-token` header; unset leaves the endpoint open                                                                                                                                  |
| `HISTORY_UPSTREAM`      | `http://127.0.0.1:3459`         | Dashboard server: base URL of the collector's history REST API. Defaults to loopback for the co-located deployment.                                                                                                                                              |
| `DIST_DIR`              | `./dist`                        | Directory the dashboard server serves static files from                                                                                                                                                                                                          |
| `VITE_WS_URL`           | current origin                  | Frontend: Socket.io URL override (defaults to the page origin; dev uses the Vite proxy)                                                                                                                                                                          |
| `VITE_ELECTION_YEAR`    | auto                            | Frontend: pin the electorate boundary dataset to an election year (e.g. `2026`). Unset, the map picks the year whose names match the live results.                                                                                                               |
| `APP_VERSION`           | `dev`                           | Build metadata exposed as `election_build_info{version}` on both processes (set at image build)                                                                                                                                                                  |
| `GIT_SHA`               | `unknown`                       | Build revision exposed as `election_build_info{revision}` on both processes (CI passes the commit SHA as a Docker build arg)                                                                                                                                     |

## Deployment

The dashboard server and the collector run together in one Fly.io app (one machine, one volume) from `Dockerfile.app`. The collector talks to the dashboard server over loopback:

```bash
WS_URL=ws://127.0.0.1:3456
HISTORY_UPSTREAM=http://127.0.0.1:3459
```

Only port 3456 is public; the collector's history API stays internal.

Fly scrapes both processes' application metrics every 15s (the two `[[metrics]]` sections in `fly.toml`: dashboard server on `:3456`, collector on `:3459`) into its managed Prometheus. Grafana dashboards live in `ops/grafana/`; see `docs/observability.md`.

The collector polls a cached static XML asset (`cache-control: public, max-age=30`) that is reachable from datacenter egress, so it does **not** need residential egress or a proxy. The two processes ship in one app; the collector also remains independently runnable via `Dockerfile.collector` if a split deployment is ever needed.

#### Election-night caveats

- **Poll no faster than the feed's cache TTL.** The 6/6 reachability result for the XML feed was measured on a static, cacheable feed. During live counting the files update every ~10s; polling faster than `cache-control: max-age` (30s) mostly hits the Cloudflare cache and risks heavier origin fetching. Keep `POLL_INTERVAL_MS` at or above the TTL on the night.
- **The media feed is a different host.** `media.election.net.nz` (live/preliminary media feed) may be more protected than `electionresults.govt.nz/electionresults_{YEAR}/xml/`; this project only reads the latter.
- **Cloudflare policy can change without notice.** The XML path is low-risk, but alert on repeated fetch failures so a bot-rule change is visible immediately rather than at 40% counted.

### Docker

Build and run the combined image (dashboard + collector):

```bash
docker build -t election-night -f Dockerfile.app .
docker run -p 3456:3456 -v election_data:/data election-night
```

The mounted volume at `/data` holds the SQLite history and JSON caches.

To run the collector alone (e.g. on a different host), use `Dockerfile.collector`:

```bash
docker build -t election-night-collector -f Dockerfile.collector .
docker run -p 3459:3459 -v election_data:/data election-night-collector
```

### Fly.io

`fly.toml` deploys the combined image and mounts a volume at `/data`. Create it once:

```bash
fly volumes create election_data --size 1 --region syd
```

State (SQLite DB, result and feed caches) lives on the volume and survives restarts and deploys. In `fly.toml`, `RESULTS_CACHE_PATH` and `CACHE_PATH` deliberately point at the same file on `/data`: the collector writes the diff baseline and the dashboard server preloads it, so the first page load after a restart is not blank. Pushes to `main` deploy automatically via `.github/workflows/deploy.yml` (gated on lint/typecheck/tests plus `security.yml` audits). PR previews use `fly.preview.toml` — no volume and `COLLECTOR_ENABLED=false`, so previews never poll the live feed.

To validate the image and the XML feed on a throwaway app before promoting it:

```bash
scripts/fly-validate.sh election-night-xmltest          # deploy + verify the XML cycle
scripts/fly-validate.sh election-night-xmltest destroy  # tear down
```

## Custom Source Adapters

Set `ELECTION_SOURCE_PATH` to a JS/TS module that exports a class implementing the `ElectionSource` interface (see `packages/core/src/types.ts`). Implementations must set `party` on each candidate vote so seat calculations work.

```bash
ELECTION_SOURCE_PATH=./my-source.ts npm run start:collector
```

The built-in source is `NzElectionXmlSource`, which reads the Electoral Commission XML feed.
