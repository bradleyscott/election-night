![Election Night Logo](./packages/dashboard/public/favicon.svg)

# Election Night — NZ General Election Result Tracker

This started as a project for a 2023 election night party — the goal was to avoid manual data entry for a "guess the result" game. It's since grown into a full real-time election night results platform that scrapes the NZ Electoral Commission site, calculates seat projections, and serves an interactive dashboard.

## Features

- **Automated scraping** — Uses a stealth Chromium (via `cloakbrowser`, Playwright backend) to pull results from the [official NZ Electoral Commission site](https://electionresults.govt.nz/) as they're published, surviving Cloudflare managed challenges.
- **Race calling** — Predicts winners per electorate with confidence levels (`too-close`, `leaning`, `likely`, `projected`) using statistical margin analysis.
- **Seat projections** — Allocates list seats via the Sainte-Laguë method to project the final parliament makeup.
- **Interactive web dashboard** — Built with React, Vite, Leaflet, Recharts, and Tailwind, dressed as a printed-edition newsroom broadsheet (see `design.md`). Includes:
  - Parliament seat grid and party vote breakdown
  - Electorate list with map, search, and per-electorate detail pages
  - "Close Calls" view
  - Live feed / commentary timeline
  - Trends page with historical charts
- **Real-time** — Socket.io broadcasts results from the scraper to all connected web clients instantly.
- **History API** — Electorate and party-vote history endpoints, served by the dashboard server from the collector's history REST API over HTTP (the server itself never opens a database).
- **Webhook notifications** — Configurable webhooks for new predictions, updated results, and leader changes (e.g., smart home integrations). A built-in webhook logger is available for local testing.
- **Persistence** — SQLite database via Drizzle ORM caches results for crash recovery and historical tracking; JSON caches and feed events are written to disk.
- **Mock server** — A built-in mock results server that serves evolving HTML for development and testing.
- **Custom source adapters** — Pluggable `ElectionSource` interface to adapt the scraper for non-NZ election sites, plus an AI-powered `discover` subcommand that generates a source adapter from a sample page.

## Architecture

```
election-night/
├── packages/
│   ├── core/          # Shared types, config, reducers, source adapters (built to dist/)
│   ├── collector/     # Scraper CLI + mock server (cloakbrowser/Playwright, Cheerio, SQLite)
│   └── dashboard/     # Vite React app + Socket.io server (Leaflet, Tailwind)
├── csv/               # Electorate, candidate, and party list data
├── .data/             # SQLite DB + JSON caches (auto-created at runtime)
```

**Socket.io is the backbone.** The collector acts as a Socket.io _client_; the dashboard package runs the Socket.io _server_. The server also serves the built Vite app, exposes health/metrics/history endpoints, and caches results to disk, so the dashboard works even if the scraper restarts.

`@election-night/core` is compiled to `dist/` and consumed as built JS; root commands run `npm run build:core` before starting the collector, server, or dashboard dev mode.

```
┌─────────────────┐  Socket.io  ┌────────────────────┐
│   Collector     │ ──────────> │  Dashboard server  │
│  cloakbrowser   │  results +  │  Socket.io server  │
│   SQLite        │  feed events│  + static files    │
└─────────────────┘             │  + history API     │
                                └────────────────────┘
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

# Start the mock election results server (evolving HTML)
npm run start:mock

# In another terminal, run the scraper pointed at the mock server
BASE_RESULTS_URL=http://localhost:3457 \
POLL_INTERVAL_MS=15000 \
npm run start:collector

# In a third terminal, start the web dashboard
npm run dev
# → http://localhost:5173
```

### Dev commands

| Command                   | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `npm run build:core`      | Compile `@election-night/core` to `dist/`                      |
| `npm run dev`             | Start web server + Vite dev server concurrently                |
| `npm run build`           | Build core + production dashboard bundle                       |
| `npm run start:collector` | Run the scraper CLI                                            |
| `npm run start:server`    | Start Socket.io / dashboard server only                        |
| `npm run start:mock`      | Start mock election results server                             |
| `npm run clear`           | Truncate the SQLite database and delete the JSON results cache |
| `npm run log:webhooks`    | Start a local webhook receiver on port 3458                    |
| `npm test`                | Run Vitest test suite                                          |
| `npm run lint`            | ESLint all packages                                            |
| `npm run typecheck`       | TypeScript type checking for core, collector, and dashboard    |
| `npm run fmt`             | Prettier format                                                |

### Mock server

The mock server simulates an evolving election night. Advance stages manually, auto-step, or query the current stage:

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

Other flags: `--port 3457` (or `MOCK_PORT`), `--help`.

## Environment Variables

| Variable                        | Default                                                | Description                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_RESULTS_URL`              | `https://electionresults.govt.nz/electionresults_2023` | URL of the election results site                                                                                                                                                                                           |
| `RESULTS_TABLE_SELECTOR`        | (NZ source default)                                    | Cheerio selector for results table/container                                                                                                                                                                               |
| `CANDIDATE_TABLE_SELECTOR`      | (NZ source default)                                    | Cheerio selector for candidate votes table                                                                                                                                                                                 |
| `PARTY_VOTE_TABLE_SELECTOR`     | (NZ source default)                                    | Cheerio selector for party votes table                                                                                                                                                                                     |
| `VOTE_PERCENT_COUNTED_SELECTOR` | (NZ source default)                                    | Cheerio selector for % counted                                                                                                                                                                                             |
| `VOTES_COUNTED_SELECTOR`        | (NZ source default)                                    | Cheerio selector for votes counted                                                                                                                                                                                         |
| `POLL_INTERVAL_MS`              | `120000`                                               | Time between scrape polls                                                                                                                                                                                                  |
| `CONCURRENCY`                   | `10`                                                   | Parallel page scrapes                                                                                                                                                                                                      |
| `NAVIGATION_TIMEOUT_MS`         | `120000`                                               | Per-page navigation/networkIdle timeout (Playwright via cloakbrowser; deliberately high so Cloudflare challenges can complete)                                                                                             |
| `FETCH_PACING_MS`               | `300`                                                  | Jittered delay between electorate fetches to avoid rate-limit bursts                                                                                                                                                       |
| `CHALLENGE_WARMUP_TIMEOUT_MS`   | `180000`                                               | Per-attempt timeout when solving the Cloudflare challenge at browser launch                                                                                                                                                |
| `CHALLENGE_WARMUP_MAX_ATTEMPTS` | `3`                                                    | Cloudflare challenge warm-up retries at browser launch                                                                                                                                                                     |
| `CHALLENGE_WARMUP_ENABLED`      | `true`                                                 | Set `false` to skip the challenge warm-up on trusted egress (e.g. a home connection)                                                                                                                                       |
| `HEALTH_PORT`                   | `3459`                                                 | Port for the collector's health/live-state JSON endpoint and `/history/*` REST API (public, unauthenticated — rate limit at the reverse proxy if exposed)                                                                  |
| `LOG_LEVEL`                     | `3`                                                    | Log verbosity (0=silly, 1=trace, 2=debug, 3=info)                                                                                                                                                                          |
| `WS_PORT`                       | `3456`                                                 | Socket.io server port                                                                                                                                                                                                      |
| `WS_URL`                        | `ws://localhost:3456`                                  | Socket.io server URL (for collector)                                                                                                                                                                                       |
| `WS_RECONNECT_DELAY_MS`         | `2000`                                                 | Delay before reconnecting to the Socket.io server                                                                                                                                                                          |
| `DB_PATH`                       | `.data/election_results.db`                            | SQLite database path                                                                                                                                                                                                       |
| `ELECTION_SOURCE_PATH`          | —                                                      | Path to a custom source adapter module                                                                                                                                                                                     |
| `WEBHOOK_URL`                   | —                                                      | Single webhook URL for all events. Payload includes an `event` field (`result_updated`, `prediction_changed`, `leader_change`, or `count_completed`) plus the full electorate result and a `diff` describing what changed. |
| `WEBHOOK_LOG_PORT`              | `3458`                                                 | Port for the local `npm run log:webhooks` receiver                                                                                                                                                                         |
| `MOCK_PORT`                     | `3457`                                                 | Port for the mock results server                                                                                                                                                                                           |
| `CLOAKBROWSER_PROXY`            | —                                                      | Proxy URL for alternate egress (e.g. residential proxy `http://user:pass@host:port`); the site WAF-blocks datacenter IPs                                                                                                   |
| `CLOAKBROWSER_GEOIP`            | `false`                                                | `true` matches timezone/locale/WebRTC to the (proxy) exit IP                                                                                                                                                               |
| `CLOAKBROWSER_HUMANIZE`         | `true`                                                 | Human-like mouse, keyboard, and scroll behaviour                                                                                                                                                                           |
| `CLOAKBROWSER_HEADLESS`         | `true`                                                 | `false` runs the stealth browser headed (needs a display, e.g. Xvfb)                                                                                                                                                       |
| `RUN_COLLECTOR`                 | `true`                                                 | Docker entrypoint toggle: set `false` to run the web server only                                                                                                                                                           |
| `CACHE_PATH`                    | `.data/electorate_results.json`                        | Dashboard server JSON cache path                                                                                                                                                                                           |
| `FEED_CACHE_PATH`               | `.data/feed_events.json`                               | Dashboard server feed-events cache path                                                                                                                                                                                    |
| `MAX_FEED_EVENTS`               | `200`                                                  | Maximum feed events retained by the dashboard server                                                                                                                                                                       |
| `HISTORY_UPSTREAM`              | `http://127.0.0.1:3459`                                | Dashboard server: base URL of the collector's history REST API — the server's _only_ source of history data. Default suits a co-located collector; point it at the homelab collector in split deployments                  |
| `DIST_DIR`                      | `./dist`                                               | Directory the dashboard server serves static files from                                                                                                                                                                    |
| `OPENAI_API_KEY`                | —                                                      | API key for the `discover` subcommand                                                                                                                                                                                      |
| `OPENAI_BASE_URL`               | `https://api.openai.com/v1`                            | Base URL for the LLM used by `discover`                                                                                                                                                                                    |
| `LLM_MODEL`                     | `gpt-4o`                                               | Model used by `discover`                                                                                                                                                                                                   |

## Deployment

Production is a two-machine setup: the **dashboard server runs in the cloud** (Fly.io, server-only) and the **collector runs on a homelab box** with residential-IP egress, publishing results to the cloud server over Socket.io.

### Docker

```bash
docker build -t election-night .
docker run -p 3456:3456 election-night
```

The container bundles the dashboard, starts the web server, and then starts the scraper (see `entrypoint.sh`). Set `RUN_COLLECTOR=false` to run the web server only.

### Fly.io (dashboard server)

`fly.toml` deploys the **server only** (`RUN_COLLECTOR=false`); the collector publishes to it from the homelab over Socket.io (`WS_URL`). The `election_data` volume persists the SQLite DB and JSON caches at `/app/.data`. Pushes to `main` deploy automatically via `.github/workflows/deploy.yml` (gated on lint/typecheck/tests plus `security.yml` audits), and PR previews are deployed by `.github/workflows/preview.yml`.

### Homelab collector (Coolify)

`Dockerfile.collector` builds a collector-only image for deployment on a residential connection (e.g. Coolify on a Proxmox LXC). It serves a health/live-state endpoint on port 3459, plus the `/history/*` REST API (public data, unauthenticated — rate limit at the proxy if you expose it) which the cloud dashboard server reads via `HISTORY_UPSTREAM` so the Trends page works across the split deployment.

## Custom Source Adapters

Set `ELECTION_SOURCE_PATH` to a JS/TS module that exports a class implementing the `ElectionSource` interface (see `packages/core/src/types.ts`). This lets you adapt the scraper for non-NZ election result sites.

```bash
ELECTION_SOURCE_PATH=./my-source.ts npm run start:collector
```

### Discover subcommand

The collector can generate a source adapter for a new election site using an LLM:

```bash
OPENAI_API_KEY=sk-... npm run start:collector -- discover --url https://example.com/electorate-results-01.html --output my-source
```

This writes `packages/core/src/sources/my-source.ts`, which you can then activate with `ELECTION_SOURCE_PATH=packages/core/src/sources/my-source.ts`.

## Data Files

CSV files in `csv/` are read at runtime:

- `electorates.csv` — Electorate names (one per line)
- `candidates.csv` — Candidate names, electorates, and parties
- `party_list.csv` — Party list rankings for list MP allocation
