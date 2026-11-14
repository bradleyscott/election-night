![Election Night Logo](./packages/dashboard/public/favicon.svg)

# Election Night — NZ General Election Result Tracker

This started as a project for a 2023 election night party — the goal was to avoid manual data entry for a "guess the result" game. It's since grown into a full real-time election night results platform that reads the NZ Electoral Commission's official XML results feed, calculates seat projections, and serves an interactive dashboard.

## Features

- **Official results feed** — Reads the Electoral Commission's official XML results feed over plain HTTPS as results are published: the live cycle from the media feed ([media.election.net.nz](https://media.election.net.nz/xml/)), finished cycles from the archive host ([archive.electionresults.govt.nz](https://archive.electionresults.govt.nz/)). No browser and no Cloudflare workarounds. The election year is configurable via `ELECTION_YEAR` (e.g. `2020`, `2023`, `2026`).
- **Chance of winning** — Every electorate carries a live probability that the candidate currently leading goes on to win it, derived from the votes counted, the votes still to come and how the outstanding vote is behaving — not from a sampling error ([method](docs/seat-probability-model.md)). A seat's full result and the live feed use the same number.
- **Seat allocation** — Reads the Commission's own list, electorate and total seats per party from `election.xml`, including the threshold rule and any overhang. The app does not derive an allocation of its own.
- **Interactive web dashboard** — Built with React, Vite, Leaflet, Recharts, and Tailwind, dressed as a printed-edition newsroom broadsheet (see `design.md`). Includes:
  - A masthead countdown to polls close (7:00pm on election day), which becomes `Polls closed · counting` on the night
  - Parliament chamber and party vote breakdown
  - Electorate list with map, search, and per-electorate detail pages
  - Close Calls page — the electorate races and party list cut lines, with its own menu entry
  - Candidates page — every candidate in the election, every seat's whole field plus every name on every party list, searchable by name, party or electorate
  - "Flipped" view — seats held by one party last election that a different party is leading now, with the previous holder's margin of victory ([notes](docs/prior-election-results.md))
  - Past winners per electorate, back to the oldest archived cycle
  - Live feed / commentary timeline
  - Trends page with historical charts
- **Real-time, revisioned** — Socket.io broadcasts a `{payload, electionYear, revision}` envelope with an acknowledgement and bounded retry. The server accepts a newer revision in the same cycle, acknowledges an exact duplicate without re-deriving events, and rejects an older revision. Delivery is at-least-once, not exactly-once.
- **Metrics** — both processes expose application-tier Prometheus metrics (`GET /metrics`): the dashboard server covers scrape freshness, socket delivery, feed state and the history API; the collector covers per-cycle timing, per-electorate fetch outcomes, webhook delivery and count progress. Fly scrapes only the server's endpoint, which merges the collector's registry over loopback; Fly adds machine metrics. Grafana dashboards are version-controlled in `ops/grafana/`; see [`docs/observability.md`](docs/observability.md) for the inventory, the best-practice assessment, and the dashboard and alert specs.
- **History API with freshness and revisions** — Electorate, party-vote, snapshot and prior-winner history is served by the dashboard server from the collector's REST API (the server itself never opens a database). Responses carry `X-Election-History-*` (verified/cached/stale, verification time and a bounded reason), `X-Election-Revision` and a trailing window with explicit `limit`/`offset`/`sinceRevision`; a browser treats a response older than the revision it has already seen as stale instead of caught up. An over-cap window is a `413`, never a truncated array. `/api/history/latest` returns the authoritative full payload for a restart/bootstrap.
- **Prior election results** — The collector derives any earlier cycle from the same XML archive on demand (`/history/results/:year`, `/history/prior-winners`), matched to today's electorates through a checked-in rename table so a merged or split seat is never given someone else's member. Historical cycles are cached in memory and never persisted; see [`docs/prior-election-results.md`](docs/prior-election-results.md).
- **Webhook notifications from a durable outbox** — Configurable webhooks for new predictions, updated results, and leader changes (e.g., smart home integrations). Announcements are stored in the snapshot transaction with a stable `eventId` and delivered by an independent loop with deadlines, bounded concurrency and retries, so a hung receiver cannot hold up the count. Delivery is at-least-once; receivers should deduplicate on `eventId`. A built-in webhook logger is available for local testing.
- **Persistence** — SQLite via Drizzle ORM, owned by a dedicated worker thread, stores count history, a cycle-scoped monotonic revision, the authoritative latest payload (electorates, parties and lists), and the webhook outbox. Additive migrations keep the existing night's history. JSON caches and feed events remain replaceable files.
- **Mock server** — A built-in mock XML feed that replays the real published results for 2020, 2023 or 2026, staged into an evolving count for development and testing.
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

**Socket.io is the backbone for live delivery, SQLite for truth.** The collector acts as a Socket.io _client_; the dashboard package runs the Socket.io _server_. The server serves the built Vite app, exposes health/metrics endpoints and a browser-facing `/api/history/*` proxy of the collector's `/history/*` REST API, and retains the latest accepted envelope for clients that connect mid-cycle. The collector's SQLite worker owns the authoritative latest state and its revision, so a dashboard-only restart recovers electorates, parties and lists from `/api/history/latest` even while the feed is quiet or unavailable — the server asks for that row at boot, before any browser connects, because the seat cache it also loads carries no party vote and no party lists.

`@election-night/core` is compiled to `dist/` and consumed as built JS; root commands run `npm run build:core` before starting the collector, server, or dashboard dev mode.

```
┌─────────────────┐  Socket.io  ┌────────────────────┐
│   Collector     │ ──────────> │  Dashboard server  │
│  XML feed poll  │  results +  │  Socket.io server  │
│  SQLite worker  │  feed events│  + static files    │
│  latest state   │ <────────── │  + /api/history/*  │
│  /history/*     │  history    │  + /api/history/   │
│  webhook outbox │             │      latest        │
└─────────────────┘             └────────────────────┘
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
| `npm run build:mock-data`                      | Regenerate the mock feed's real candidate/result fixture       |
| `node scripts/generate-icons.mjs`              | Regenerate the app icons from one square master                |
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

### App icons

The logo is a wide mark — the mascot plus two ballot flags — and every platform
that shows it crops to a square: the home screen, the Android and iOS splash
screens, the browser tab. Rasterising the wide mark straight to a square
filename ships a non-square file that the OS stretches, which is how the splash
screen ended up showing a squashed mascot. `scripts/generate-icons.mjs` lays the
artwork into one square canvas instead and renders every size from it, keeping
the maskable variant inside Android's 80% safe circle:

```bash
# Rewrites favicon.svg, favicon.ico, the manifest PNGs and apple-touch-icon.png
# (needs ImageMagick, plus Inkscape or rsvg-convert on PATH)
node scripts/generate-icons.mjs
```

Commit the regenerated files. `packages/dashboard/src/lib/app-icons.test.ts`
asserts each shipped icon is square and the size `site.webmanifest` declares.

### Mock server

The mock server serves a mock version of the Electoral Commission XML feed (`candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml`) that simulates an evolving election night. It replays the **real published results** for 2020, 2023 or 2026 — real candidate names, real party and candidate votes, and the real winner in each seat — scaled into four partial counts. Point the collector at it with `XML_FEED_BASE_URL=http://localhost:3457/`. Advance stages manually, auto-step, or query the current stage:

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

Other flags: `--port 3457` (or `MOCK_PORT`), `--year 2020|2023|2026` (or `MOCK_ELECTION_YEAR`), `--help`.

#### Replaying a real cycle

`--year 2026` replays the 2026 electorate list: 64 general + 7 Māori electorates instead of 65 + 7, with the 2026 names (`Kapiti`, `Kenepuru`, `Glendene`, `Henderson`, `Waitākere`, `Ōtāhuhu`, `Mt Maunganui`, `East Cape`, `Wellington North`, `Wellington Bays`) and the 2023 ones gone. It also replays the published 2026 result, including its overhang: the Commission's table totals 131 seats because National won 42 electorates and Te Pāti Māori 5 on a small party vote.

`--year 2020` and `--year 2023` use the same 65 + 7 electorate list, because those cycles were fought on the same boundaries; the dashboard draws both with the 2023 polygons. The per-seat tendencies are the real ones — Epsom and Tāmaki go to ACT, Māngere to Labour, and the Māori seats split the way they did in that cycle.

The fixture behind this is `packages/collector/src/mock-election-data.json`, generated by `npm run build:mock-data` from the 2020 and 2023 archives and the 2026 live media feed. Nothing is invented at runtime, and a replay is deterministic.

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

## Prior election results

`/flipped` and the **Past winners** table on an electorate page are fed by the collector's results service, which fetches any earlier cycle from the same XML archive on demand, caches it in memory, and matches its seats to today's electorates through a checked-in rename table. Only seats that continued under the same electoral area are compared — a seat created by a merge or split has no prior holder and is left out rather than given a guess.

The mock feed replays a single cycle, so `XML_FEED_BASE_URL` is only ever used for the cycle being counted. Prior years fall through to the real archive, which is the authority for them and needs no override — a mocked 2026 run still gets real 2023, 2020 and 2017 winners, so `/flipped` and the past-winners table are populated instead of blank.

Set `PRIOR_RESULTS=off` to serve no prior cycle at all. That is what the tests that spawn the collector do, so they never touch the network:

```bash
PRIOR_RESULTS=off ELECTION_YEAR=2026 XML_FEED_BASE_URL=http://localhost:3457/ npm run start:collector
```

See [`docs/prior-election-results.md`](docs/prior-election-results.md) for the contract, the comparability rule and its sources.

## Environment Variables

| Variable                | Default                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ELECTION_YEAR`         | `2023`                          | Election year for the XML feed. 2026 and later read the live media feed at `https://media.election.net.nz/xml/`; earlier cycles read the archive at `https://archive.electionresults.govt.nz/electionresults_<year>/xml/`. Also tags stored snapshots and the results and feed caches with the cycle, so history, diffs and feed events never mix two elections. Also selects the masthead's polls-close instant ([`packages/core/src/polls-close.ts`](packages/core/src/polls-close.ts), published on `GET /api/config`); a cycle with no listed instant shows the plain clock. |
| `XML_FEED_BASE_URL`     | —                               | Full override for the XML feed base URL (must end with `/`); takes precedence over `ELECTION_YEAR`. Point this at the mock server. It applies only to the cycle being counted; prior years still read the real archive.                                                                                                                                                                                                                                                                                                                                                          |
| `PRIOR_ELECTION_YEAR`   | previous cycle                  | Cycle the Flipped page compares against. Unset uses the newest prior cycle the archive resolves (the preceding election). Older cycles are still fetched for the per-electorate past-winners table.                                                                                                                                                                                                                                                                                                                                                                              |
| `PRIOR_RESULTS`         | `on`                            | Collector: set `off` to serve no prior cycle at all. Tests that spawn the collector set it so they never touch the network; `XML_FEED_BASE_URL` does **not** disable prior results, because a mocked run should still fill Flipped and Past winners from the real archive.                                                                                                                                                                                                                                                                                                       |
| `POLL_INTERVAL_MS`      | `60000`                         | How often the collector asks the feed whether anything changed. Each check is an `If-Modified-Since` request: a 304 costs headers and no body, and a cycle where every seat 304s writes no snapshot and publishes nothing. Jittered ±20%, capped at ±5 minutes so a daily interval still means a day. `fly.toml` deploys `86400000` until the count — see [Machine size and poll cadence](#machine-size-and-poll-cadence).                                                                                                                                                       |
| `CONCURRENCY`           | `10`                            | Parallel electorate fetches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `FETCH_TIMEOUT_MS`      | `30000`                         | Per-request HTTP timeout for XML feed fetches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FETCH_PACING_MS`       | `300`                           | Jittered delay between electorate fetches to avoid rate-limit bursts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `HEALTH_PORT`           | `3459`                          | Port for the collector's health/live-state JSON endpoint and `/history/*` REST API (the dashboard server is the only client; loopback in the combined image, so rate limit it at the reverse proxy only if you expose it)                                                                                                                                                                                                                                                                                                                                                        |
| `LOG_LEVEL`             | `3`                             | Log verbosity (0=silly, 1=trace, 2=debug, 3=info)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `WS_PORT`               | `3456`                          | Socket.io server port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WS_URL`                | `ws://localhost:3456`           | Socket.io server URL (for the collector); loopback in the combined deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `WS_RECONNECT_DELAY_MS` | `2000`                          | Delay before reconnecting to the Socket.io server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DB_PATH`               | `.data/election_results.db`     | Collector: SQLite database path (the dashboard server never opens a DB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RETENTION_HOURS`       | `24`                            | Collector: hours of snapshots to keep, enforced on startup and then every `RETENTION_SWEEP_MS`, oldest first (the newest snapshot is always kept; `0` keeps everything). This is what bounds the database: without it the volume fills, SQLite fails every write with `SQLITE_FULL`, and the site serves nothing while the collector keeps fetching.                                                                                                                                                                                                                             |
| `RETENTION_SWEEP_MS`    | `900000`                        | Collector: how often the running process prunes and compacts. `0` prunes only at startup, which is not enough for a process that runs for weeks.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `HISTORY_WINDOW_HOURS`  | `24`                            | Collector: trailing window the history API reads. Defaults to the retention window, so a snapshot the collector would already prune cannot reappear in a chart.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `HISTORY_MAX_SNAPSHOTS` | `2000`                          | Collector: hard cap on snapshots in one history response (a 60s poll yields 1,440 in 24h). A window that exceeds it is refused with an explicit `413`; callers page with `?limit=&offset=` rather than receive a silently truncated array.                                                                                                                                                                                                                                                                                                                                       |
| `RESULTS_CACHE_PATH`    | `.data/electorate_results.json` | Collector: JSON cache of the current cycle's electorate results, used as the webhook diff baseline. Tagged with `ELECTION_YEAR` — a cache from another cycle is ignored rather than diffed against. In the combined image this is the same file as `CACHE_PATH`.                                                                                                                                                                                                                                                                                                                 |
| `ELECTION_SOURCE_PATH`  | —                               | Path to a custom source adapter module implementing `ElectionSource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `WEBHOOK_URL`           | —                               | Single webhook URL for all events. Payload includes an `event` field (`result_updated`, `prediction_changed`, `leader_change`, or `count_completed`), a stable `eventId`, the cycle/revision when known, the full electorate result and a `diff`. Delivery is from a durable outbox with bounded retries; treat it as at-least-once and deduplicate on `eventId`.                                                                                                                                                                                                                |
| `WEBHOOK_LOG_PORT`      | `3458`                          | Port for the local `npm run log:webhooks` receiver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `MOCK_PORT`             | `3457`                          | Port for the mock XML feed server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MOCK_ELECTION_YEAR`    | `2023`                          | Mock server: which cycle's electorate list to replay (`2023` or `2026`). Overridden by `--year`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `COLLECTOR_ENABLED`     | `true`                          | Combined image only: set `false` to run the dashboard server without the collector (PR previews do this)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `COLLECTOR_WATCHDOG`    | `on`                            | Dashboard server: probes the collector's `/health` every 10s and exits after six consecutive failures so the entrypoint restarts the machine. Set `off` to disable; it runs only when `NODE_ENV=production` and `COLLECTOR_ENABLED=true`.                                                                                                                                                                                                                                                                                                                                        |
| `CACHE_PATH`            | `.data/electorate_results.json` | Dashboard server JSON cache path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FEED_CACHE_PATH`       | `.data/feed_events.json`        | Dashboard server feed-events cache path. Tagged with `ELECTION_YEAR` — a cache from another cycle is ignored (with a warning) rather than preloaded as the current cycle's feed                                                                                                                                                                                                                                                                                                                                                                                                  |
| `MAX_FEED_EVENTS`       | `200`                           | Maximum feed events retained by the dashboard server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `CLEAR_TOKEN`           | —                               | Dashboard server: when set, `POST /api/clear` requires this value in the `x-clear-token` header; unset leaves the endpoint open                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ALLOW_REMOTE_RESULTS`  | `false`                         | Dashboard server: accept results from a remote publisher (split deployments only); off, only the co-located collector may publish. On its own this is a permission, not authentication: a remote publisher must also present `RESULTS_TOKEN`.                                                                                                                                                                                                                                                                                                                                    |
| `RESULTS_TOKEN`         | —                               | Shared token for a split deployment: the collector sends it in the Socket.IO handshake `auth.token`, and the dashboard server requires it when `ALLOW_REMOTE_RESULTS=true`. Unset means remote publishers are rejected.                                                                                                                                                                                                                                                                                                                                                          |
| `HISTORY_UPSTREAM`      | `http://127.0.0.1:3459`         | Dashboard server: base URL of the collector's history REST API. Defaults to loopback for the co-located deployment.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `COLLECTOR_METRICS_URL` | `<HISTORY_UPSTREAM>/metrics`    | Dashboard server: collector `/metrics` URL merged into the scraped `/metrics` (Fly scrapes only one endpoint per process). Set empty to disable the merge.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DIST_DIR`              | `./dist`                        | Directory the dashboard server serves static files from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `VITE_WS_URL`           | current origin                  | Frontend: Socket.io URL override (defaults to the page origin; dev uses the Vite proxy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `VITE_ELECTION_YEAR`    | auto                            | Frontend: pin the electorate boundary dataset to an election year (e.g. `2026`). Unset, the map picks the year whose names match the live results.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `APP_VERSION`           | `dev`                           | Build metadata exposed as `election_build_info{version}` on both processes (set at image build)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GIT_SHA`               | `unknown`                       | Build revision exposed as `election_build_info{revision}` on both processes (CI passes the commit SHA as a Docker build arg)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Deployment

The dashboard server and the collector run together in one Fly.io app (one machine, one volume) from `Dockerfile.app`. The collector talks to the dashboard server over loopback:

**Migrations and rollback.** Migrations `0003`-`0005` are additive (history indexes, `latest_state`, `webhook_outbox`, nullable revision/model columns). Rolling back the app image leaves them in place; old code ignores them. Do not delete the volume to roll back, and do not use `npm run clear` as a rollback step (it starts a new cycle). Take a volume snapshot before any destructive schema change.

```bash
WS_URL=ws://127.0.0.1:3456
HISTORY_UPSTREAM=http://127.0.0.1:3459
```

Only port 3456 is public; the collector's history API stays internal.

Fly scrapes the dashboard server's `/metrics` on `:3456` every 15s into its managed Prometheus. Fly scrapes only **one** metrics endpoint per process (multiple `[[metrics]]` sections apply across Fly process groups, which are separate Machines), so that endpoint merges the collector's registry over loopback (`COLLECTOR_METRICS_URL`, default `<HISTORY_UPSTREAM>/metrics`). Grafana dashboards live in `ops/grafana/`; see `docs/observability.md`.

The collector polls a cached static XML asset (`cache-control: public, max-age=30`) that is reachable from datacenter egress, so it does **not** need residential egress or a proxy. The two processes ship in one app; the collector also remains independently runnable via `Dockerfile.collector` if a split deployment is ever needed.

#### Election-night caveats

- **The masthead counts down to the served cycle's polls close.** Before the close it counts down; on the night it reads `Polls closed · counting`; any other time (an archived cycle, or no cycle) it falls back to the plain date and time instead of implying a live count. A local run on the default `ELECTION_YEAR=2023` therefore shows the clock — use `ELECTION_YEAR=2026` to see the countdown.

- **Poll with conditional requests, not with bigger intervals.** Every electorate fetch sends `If-Modified-Since`; the feed answers `304 Not Modified` with an empty body when nothing has been republished, and a cycle in which every seat 304s writes no snapshot and publishes nothing. That is what makes a `POLL_INTERVAL_MS` of a minute affordable: the cost of a quiet check is headers, not 71 bodies. Two traps: the feed's ETag is a weak gzip variant that never matches, and a failed `If-None-Match` overrides `If-Modified-Since` and forces a full 200 — so send `If-Modified-Since` only.
- **The check is per seat, so it is still 71 requests a minute.** `election.xml` carries an `updated` stamp that looks like a cheaper global gate, but the Commission may rewrite only the seats a batch touched, so a national stamp is not a reliable "nothing anywhere changed" signal — a pre-check built on it could miss a seat. At the one-minute cadence that is ~4,300 requests an hour against a cached static asset, in short bursts of roughly 25 rps while a cycle reads, not a sustained rate; `FETCH_PACING_MS` spaces the requests inside a cycle. Raise `POLL_INTERVAL_MS` if that ever becomes a problem for the feed.
- **"Changed" is the payload, not the transport.** The collector hashes the counted facts in the payload it would publish and compares that with the last payload whose publish _completed_. A stamp that moved over identical content is not a change; a body that changed without a moving `Last-Modified` still is; and a write that failed leaves the hash unset, so the next quiet cycle retries it. There is no timed unconditional sweep: a seat with no stamp (a first cycle, a restart, a seat that never answered) is downloaded unconditionally. If the origin ever served changed content behind a frozen `Last-Modified`, the count would stop publishing — `election_last_scrape_timestamp_seconds` going still during a live count is the warning sign (`docs/observability.md` §6), separate from the liveness gauge.
- **A source without conditional support publishes every cycle.** Custom adapters (`ELECTION_SOURCE_PATH`) and the archive cannot answer 304, so every poll downloads every seat and every cycle publishes. The collector prints `CONDITIONAL POLL: no` at startup and the loop behaves exactly as it did before this existed. `npm run start:mock` sends `Last-Modified` and honours `If-Modified-Since`, so a dry run exercises the 304 path; `--auto-step` moves the stamp, which is the mock's equivalent of a batch landing.
- **Mixed 304/200 in one cycle does not mean a straddled publish.** The Commission may rewrite only the seats a batch touched, so some files change and some do not. Do not build a re-run rule on the mix; compare the payload's counted facts, which is what decides whether a cycle publishes.
- **The live cycle and the archives are on different hosts.** The cycle being counted is published on the bare media feed (`media.election.net.nz/xml/`, no year in the path); finished cycles are filed under their year on `archive.electionresults.govt.nz`. The old `electionresults.govt.nz/electionresults_{YEAR}/xml/` paths stopped serving XML when the results site was rebuilt for 2026 — they 404 even for 2017/2020/2023, which is why the source picks the host from the year rather than from one pattern. `XML_FEED_BASE_URL` overrides both.
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

State (SQLite DB, result and feed caches) lives on the volume and survives restarts and deploys. In `fly.toml`, `RESULTS_CACHE_PATH` and `CACHE_PATH` deliberately point at the same file on `/data`: the collector writes the diff baseline and the dashboard server preloads it, so the first page load after a restart is not blank. Pushes to `main` deploy automatically via `.github/workflows/deploy.yml` (gated on lint/typecheck/tests plus `security.yml`, where high-severity advisories in production dependencies block the deploy and dev-only ones are reported without blocking). PR previews use `fly.preview.toml` — no volume and `COLLECTOR_ENABLED=false`, so previews never poll the live feed.

Machine size and the poll cadence are both `fly.toml` settings, and both are set
for the quiet period between counts rather than for a count night — see
[Machine size and poll cadence](#machine-size-and-poll-cadence) for the values in
force and the ones to restore before the official count is declared.

### Machine size and poll cadence

Two `fly.toml` knobs move with the calendar, and both are currently set for a
period with nothing left to count:

| Setting                  | Until the official count                                                           | Election night                                         |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `[env] POLL_INTERVAL_MS` | `86400000` (one sweep a day)                                                       | `60000` while results flow, `30000` for the final hour |
| `[[vm]]`                 | `memory = "512mb"`, `cpus = 1` (one step up from Fly's 256 MB floor, ~$3.69/month) | `memory = "1gb"`, `cpus = 2`                           |

**The cadence.** Between the night's preliminary count and the official count —
declared 20 days after election day, and the next time the feed is expected to
change — the feed is a static asset, so a one-minute poll is ~4,300 requests an
hour asking it whether it moved. A quiet cycle is 71 conditional requests
(`If-Modified-Since`, 304, no body), writes no snapshot and broadcasts nothing,
so a daily sweep costs 71 requests and still notices a recount or an early
publication, up to a day late.

Two things make the slow interval mean what it says. The tick's ±20% jitter is
**capped at five minutes either way**
([`packages/collector/src/poll-delay.ts`](packages/collector/src/poll-delay.ts)),
because ±20% of a day is ±4.8 hours and would random-walk the schedule by a fifth
of a day every night. And the collector's liveness signal moves once per poll, so
the `$POLL` in [the alert table](docs/observability.md#6-alerting) has to be read
as 24h — the pipeline-stalled window becomes three days — until the cadence is
back to a minute. Nothing else changes meaning: the dashboard's watchdog probes
the collector's `/health` every 10s regardless of cadence, and a failed cycle
still writes nothing and retries on the next tick.

**The size.** 512 MB and one shared vCPU is a quiet-period size one step up from
Fly's 256 MB floor: it holds the dashboard, the collector's idle loop, one SQLite
handle and whoever happens to be connected with a little room left over, which
the 256 MB floor did not leave for a co-located collector. It is **not** a
count-night size: the dashboard holds every websocket in one process, so 1 GB is
headroom for the connections alongside the collector, and the second vCPU is CPU
quota rather than a second Node thread (Node runs one thread, but a shared vCPU is
throttled). Watch the memory-headroom panel after any change, and treat
`fly_instance_exit_oom` as the sign the size is wrong.

Change both here, in a commit — not with `fly scale` or `fly machine update`,
because `[[vm]]` and `[env]` take precedence on the next deploy, and the next CI
deploy would revert an ad-hoc change (the same rule as `ELECTION_YEAR`). A resize
restarts the Machine, so do it before a count, not during one.

### Switching to a new cycle

The served cycle is `ELECTION_YEAR` in `fly.toml`'s `[env]`, and it decides four
things at once: which XML feed is fetched, the cycle stamped on each snapshot
(and so which rows `/history/*` returns), the tag on the results and feed caches,
and which polls-close instant the masthead counts down to. Editing it in a commit
is what switches production — an ad-hoc `fly machine update --env` is reverted by
the next CI deploy.

A cycle the Commission has not published yet 404s, and a conditional poll cannot
help there — every reference-data load fails, so every cycle fails. The collector
does not need a staged cadence for that: a failed cycle writes nothing and
inserts no snapshot row, and the loop retries on the next tick. Keep
`POLL_INTERVAL_MS` at its normal value and let the failures ride; the
fetch-failure metric goes red until the feed appears, which is exactly what it is
for. Once the ballot is published — 2026's went live before election night with
every count zeroed — conditional requests do the staging for you, and a quiet
cycle costs headers, not downloads.

If you do want a quiet interval while a cycle is unpublished (a long gap between
elections on a public deployment), raise `POLL_INTERVAL_MS`: nothing else changes
meaning. That is exactly what `fly.toml` now deploys, so
[Machine size and poll cadence](#machine-size-and-poll-cadence) lists both the
current values and the ones to put back before polls close.

While the feed 404s the collector stays up and logs one failed cycle per
interval, writing nothing: the reference-data load is retried on every poll and a
failed fetch never reaches the worker's `writeSnapshot`, so no snapshot row is inserted. It must
never exit here — the entrypoint tears the machine down when the collector dies
(`wait -n`), so an unpublished feed would crash-loop the whole app, dashboard
included, until Fly's restart budget ran out. The site shows its "awaiting
results" state with the countdown and the new cycle's boundaries. The map needs no build-time pin: with no results,
`selectBoundaryYear` falls back to the newest boundary dataset.

Wipe the previous cycle's state **after** the switch has deployed, never before:
until the collector is reading the new cycle it re-creates the old cycle's rows
within one poll interval.

```bash
# Truncates every table and deletes both JSON caches on the volume.
fly ssh console -a election-night -C "sh -lc 'cd /app && npx tsx packages/collector/src/clear.ts'"
```

History is already scoped by cycle, and `latest_state` is keyed by cycle, so a
new cycle gets its own latest row and old rows cannot leak into its charts;
clearing is about not carrying a finished cycle's volume footprint forward. The
migrations are additive, so switching a cycle never requires deleting the
volume or rebuilding the database. The JSON caches are the sharper edge: both are tagged
with the cycle they belong to, and a cache from another cycle is ignored (with a
warning naming the reason) rather than preloaded as the current cycle's results or
feed.[^pre-tag]

[^pre-tag]:
    A cache written before the tagging existed is a bare array with
    nothing to attribute it to a cycle. It is accepted only when `ELECTION_YEAR`
    is unset; with a known cycle it is skipped, because a 2023 feed cache
    preloaded onto a 2026 site would open on the previous election's commentary.

### Keeping the volume from filling

Every cycle writes a full snapshot, so an unbounded database grows with the poll
rate — about 280 MB/day at the 60-second default, which fills a 1 GB volume in
under four days. Two things keep it bounded, because production runs for weeks at
a time:

- **Continuous retention.** `RETENTION_HOURS` (default 24) is enforced on
  startup and then swept every `RETENTION_SWEEP_MS` (default 15 minutes) for the
  life of the process. A volume that drops below 5% free abandons the configured
  window for one hour's worth of history: a database that cannot be written
  serves nothing at all, so shedding old snapshots is the better failure.
- **Compaction.** The database runs with incremental auto-vacuum, so each sweep
  hands the pages it freed back to the filesystem rather than only recycling
  them. Without this the file keeps the high-water mark of its busiest period
  forever, and a single busy night would leave it permanently near full.
- **The rest of the schema is bounded too.** `latest_state` is one row per
  cycle (the full payload, so recovering it costs no count history). The webhook
  outbox prunes delivered rows after a day, dead letters after a week, and caps
  the retained set at 5,000 rows, so a broken receiver cannot fill the volume.
  Retention does not delete the latest state or the outbox; both have their own
  bounds.

When a volume does fill despite that, the failure is quiet and misleading: the
collector keeps fetching results successfully and every SQLite write fails with
`SQLITE_FULL`, so the dashboard has nothing to serve and pages show "awaiting
results" rather than an error. Recovery needs free space — a `DELETE` needs WAL
space too, so pruning in place on a 100% full volume cannot work (`fly volumes
extend` is the way out, after which the retention window brings the steady state
back to the window's own size, about 280 MB at the default cadence). Watch
`election_disk_available_bytes /
election_disk_size_bytes` and `election_snapshot_writes_total{status="error"}`;
both have alert rules in `docs/observability.md` §6.

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
