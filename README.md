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
- **Real-time** — Socket.io pushes results to every connected browser the moment the in-process collector writes them.
- **History API** — Electorate and party-vote history endpoints, served straight from the SQLite snapshots the collector writes.
- **Webhook notifications** — Configurable webhooks for new predictions, updated results, and leader changes (e.g., smart home integrations). A built-in webhook logger is available for local testing.
- **Persistence** — SQLite database via Drizzle ORM with one immutable snapshot per scrape, giving crash recovery, history and trends; feed events are cached to disk.
- **Mock server** — A built-in mock XML feed server that serves evolving results for development and testing.
- **Custom source adapters** — Pluggable `ElectionSource` interface to adapt the collector for non-NZ elections or other feeds.

## Architecture

```
election-night/
├── packages/
│   ├── core/          # Shared types, config, reducers, XML source adapter (built to dist/)
│   ├── collector/     # Feed polling loop + SQLite read/write, imported in-process (no browser)
│   └── dashboard/     # Vite React app + the Node server that runs everything
├── .data/             # SQLite DB + feed-event cache (auto-created at runtime)
```

**One process.** The dashboard server starts the collector in-process, so a scrape reaches the browser by direct call. Socket.io carries results from the server to browsers and nothing else. The server serves the built Vite app, exposes health/metrics/history endpoints, and reads the same SQLite file the collector writes — there is no history HTTP hop and no JSON results cache to keep in step.

`@election-night/core` is compiled to `dist/` and consumed as built JS; root commands run `npm run build:core` before starting the server or dashboard dev mode. `@election-night/collector` is consumed as TypeScript source.

```
┌──────────────────────────────────────────────┐
│            Dashboard server (:3456)          │
│                                              │
│  collector loop ──> SQLite ──> history API   │
│        │                        /api/*       │
│        └──────> Socket.io ──────> broadcast  │
│                 + static files               │
└──────────────────────────────────────────────┘
                        │
                        ▼
              ┌────────────────────┐
              │   Browser clients  │
              │   React + Leaflet  │
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

# In another terminal, run the server with its in-process collector pointed at
# the mock feed, plus the Vite dev server
XML_FEED_BASE_URL=http://localhost:3457/ \
POLL_INTERVAL_MS=15000 \
npm run dev
# → http://localhost:5173
```

### Dev commands

| Command                                        | Description                                                    |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `npm run build:core`                           | Compile `@election-night/core` to `dist/`                      |
| `npm run dev`                                  | Start the server + in-process collector and the Vite dev server |
| `npm run build`                                | Build core + production dashboard bundle                       |
| `npm run start:server`                         | Start the server (with the collector) without Vite             |
| `npm run start:mock`                           | Start mock election results server                             |
| `npm run clear`                                | Truncate the SQLite database                                   |
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

# Terminal 2 — server + collector reading it, plus the dashboard
XML_FEED_BASE_URL=http://localhost:3457/ ELECTION_YEAR=2026 npm run dev
```

Set `ELECTION_YEAR=2026` too (not just the mock flag): it tags snapshots with the cycle, so the 2026 replay does not mix into 2023 history, and the dashboard's map picks the 2026 boundaries to match. Advance stages with the `curl` calls above to watch counts, predictions, and seat totals move.

## Environment Variables

| Variable               | Default                     | Description                                                                                                                                                                                                                |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ELECTION_YEAR`        | `2023`                      | Election year for the XML feed; builds `https://electionresults.govt.nz/electionresults_<year>/xml/`                                                                                                                       |
| `XML_FEED_BASE_URL`    | —                           | Full override for the XML feed base URL (must end with `/`); takes precedence over `ELECTION_YEAR`. Point this at the mock server.                                                                                         |
| `POLL_INTERVAL_MS`     | `30000`                     | Time between feed polls. The feed is CDN-cached with `max-age` 30s and a full cycle takes ~1s, so polling faster gains nothing.                                                                                             |
| `CONCURRENCY`          | `10`                        | Parallel electorate fetches                                                                                                                                                                                                |
| `FETCH_TIMEOUT_MS`     | `5000`                      | Per-request HTTP timeout for XML feed fetches (responses are ~13ms; this is a hang guard)                                                                                                                                  |
| `LOG_LEVEL`            | `3`                         | Log verbosity (0=silly, 1=trace, 2=debug, 3=info)                                                                                                                                                                          |
| `COLLECTOR_ENABLED`    | `true`                      | Run the in-process collector loop. `false` serves the last written snapshot without polling (PR previews do this).                                                                                                          |
| `WS_PORT`              | `3456`                      | Public HTTP + Socket.io port                                                                                                                                                                                               |
| `DB_PATH`              | `.data/election_results.db` | SQLite database path (written by the collector, read by the history API)                                                                                                                                                    |
| `ELECTION_SOURCE_PATH` | —                           | Path to a custom source adapter module implementing `ElectionSource`                                                                                                                                                       |
| `WEBHOOK_URL`          | —                           | Single webhook URL for all events. Payload includes an `event` field (`result_updated`, `prediction_changed`, `leader_change`, or `count_completed`) plus the full electorate result and a `diff` describing what changed. |
| `WEBHOOK_LOG_PORT`     | `3458`                      | Port for the local `npm run log:webhooks` receiver                                                                                                                                                                         |
| `MOCK_PORT`            | `3457`                      | Port for the mock XML feed server                                                                                                                                                                                          |
| `MOCK_ELECTION_YEAR`   | `2023`                      | Mock server: which cycle's electorate list to replay (`2023` or `2026`). Overridden by `--year`.                                                                                                                           |
| `FEED_CACHE_PATH`      | `.data/feed_events.json`    | Dashboard server feed-events cache path                                                                                                                                                                                    |
| `MAX_FEED_EVENTS`      | `200`                       | Maximum feed events retained by the dashboard server                                                                                                                                                                       |
| `CLEAR_TOKEN`          | —                           | When set, `POST /api/clear` requires it in the `x-clear-token` header                                                                                                                                                      |
| `DIST_DIR`             | `./dist`                    | Directory the dashboard server serves static files from                                                                                                                                                                    |
| `VITE_ELECTION_YEAR`   | auto                        | Frontend: pin the electorate boundary dataset to an election year (e.g. `2026`). Unset, the map picks the year whose names match the live results.                                                                         |

## Deployment

The dashboard server and the collector run as **one process** in one Fly.io app (one machine, one volume) from `Dockerfile.app`. Only port 3456 is public.

The collector polls a cached static XML asset, so it does **not** need residential egress or a proxy. See `docs/deployment-simplification.md` for the analysis and alternatives.

### Docker

```bash
docker build -t election-night -f Dockerfile.app .
docker run -p 3456:3456 -v election_data:/data election-night
```

The mounted volume at `/data` holds the SQLite history and the feed-event cache.

### Fly.io

`fly.toml` deploys the combined image and mounts a volume at `/data`. Create it once:

```bash
fly volumes create election_data --size 1 --region syd
```

State (SQLite DB, feed-event cache) lives on the volume and survives restarts and deploys. Pushes to `main` deploy automatically via `.github/workflows/deploy.yml` (gated on lint/typecheck/tests plus `security.yml` audits). PR previews use `fly.preview.toml` — no volume and `COLLECTOR_ENABLED=false`, so previews never poll the live feed.

To validate the image and the XML feed on a throwaway app before promoting it:

```bash
scripts/fly-validate.sh election-night-xmltest          # deploy + verify the XML cycle
scripts/fly-validate.sh election-night-xmltest destroy  # tear down
```

## Custom Source Adapters

Set `ELECTION_SOURCE_PATH` to a JS/TS module that exports a class implementing the `ElectionSource` interface (see `packages/core/src/types.ts`). Implementations must set `party` on each candidate vote so seat calculations work.

```bash
ELECTION_SOURCE_PATH=./my-source.ts npm run start:server
```

The built-in source is `NzElectionXmlSource`, which reads the Electoral Commission XML feed.
