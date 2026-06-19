![Election Night Logo](./packages/dashboard/public/favicon.svg)

# Election Night — NZ General Election Result Tracker

This started as a project for a 2023 election night party — the goal was to avoid manual data entry for a "guess the result" game. It's since grown into a full real-time election night results platform that scrapes the NZ Electoral Commission site, calculates seat projections, and serves an interactive dashboard.

## Features

- **Automated scraping** — Uses Puppeteer (via `cloakbrowser`/`puppeteer-core`) to pull results from the [official NZ Electoral Commission site](https://electionresults.govt.nz/) as they're published.
- **Race calling** — Predicts winners per electorate with confidence levels (`too-close`, `leaning`, `likely`, `projected`) using statistical margin analysis.
- **Seat projections** — Allocates list seats via the Sainte-Laguë method to project the final parliament makeup.
- **Interactive web dashboard** — Built with React, Vite, Leaflet, Recharts, and Tailwind. Includes:
  - Parliament seat grid and party vote breakdown
  - Electorate list with map, search, and per-electorate detail pages
  - "Close Calls" view
  - Live feed / commentary timeline
  - Trends page with historical charts
- **Real-time** — Socket.io broadcasts results from the scraper to all connected web clients instantly.
- **History API** — The dashboard server reads the SQLite database to serve electorate and party-vote history endpoints.
- **Webhook notifications** — Configurable webhooks for new predictions, updated results, and leader changes (e.g., smart home integrations). A built-in webhook logger is available for local testing.
- **Persistence** — SQLite database via Drizzle ORM caches results for crash recovery and historical tracking; JSON caches and feed events are written to disk.
- **Mock server** — A built-in mock results server that serves evolving HTML for development and testing.
- **Custom source adapters** — Pluggable `ElectionSource` interface to adapt the scraper for non-NZ election sites, plus an AI-powered `discover` subcommand that generates a source adapter from a sample page.

## Architecture

```
election-night/
├── packages/
│   ├── core/          # Shared types, config, reducers, source adapters (built to dist/)
│   ├── collector/     # Scraper CLI + mock server (Puppeteer, Cheerio, SQLite)
│   └── dashboard/     # Vite React app + Socket.io server (Leaflet, Tailwind)
├── csv/               # Electorate, candidate, and party list data
├── .data/             # SQLite DB + JSON caches (auto-created at runtime)
└── deploy/            # Docker entrypoint and deployment helpers
```

**Socket.io is the backbone.** The collector acts as a Socket.io *client*; the dashboard package runs the Socket.io *server*. The server also serves the built Vite app, exposes health/metrics/history endpoints, and caches results to disk, so the dashboard works even if the scraper restarts.

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

| Command | Description |
|---|---|
| `npm run build:core` | Compile `@election-night/core` to `dist/` |
| `npm run dev` | Start web server + Vite dev server concurrently |
| `npm run build` | Build core + production dashboard bundle |
| `npm run start:collector` | Run the scraper CLI |
| `npm run start:server` | Start Socket.io / dashboard server only |
| `npm run start:mock` | Start mock election results server |
| `npm run clear` | Truncate the SQLite database and delete the JSON results cache |
| `npm run log:webhooks` | Start a local webhook receiver on port 3458 |
| `npm test` | Run Vitest test suite |
| `npm run lint` | ESLint all packages |
| `npm run typecheck` | TypeScript type checking for core, collector, and dashboard |
| `npm run fmt` | Prettier format |

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

| Variable | Default | Description |
|---|---|---|
| `BASE_RESULTS_URL` | `https://electionresults.govt.nz/electionresults_2023` | URL of the election results site |
| `RESULTS_TABLE_SELECTOR` | (NZ source default) | Cheerio selector for results table/container |
| `CANDIDATE_TABLE_SELECTOR` | (NZ source default) | Cheerio selector for candidate votes table |
| `PARTY_VOTE_TABLE_SELECTOR` | (NZ source default) | Cheerio selector for party votes table |
| `VOTE_PERCENT_COUNTED_SELECTOR` | (NZ source default) | Cheerio selector for % counted |
| `VOTES_COUNTED_SELECTOR` | (NZ source default) | Cheerio selector for votes counted |
| `POLL_INTERVAL_MS` | `120000` | Time between scrape polls |
| `CONCURRENCY` | `10` | Parallel page scrapes |
| `NAVIGATION_TIMEOUT_MS` | `60000` | Puppeteer navigation timeout |
| `LOG_LEVEL` | `3` | Log verbosity (0=silly, 1=trace, 2=debug, 3=info) |
| `WS_PORT` | `3456` | Socket.io server port |
| `WS_URL` | `ws://localhost:3456` | Socket.io server URL (for collector) |
| `WS_RECONNECT_DELAY_MS` | `2000` | Delay before reconnecting to the Socket.io server |
| `DB_PATH` | `.data/election_results.db` | SQLite database path |
| `ELECTION_SOURCE_PATH` | — | Path to a custom source adapter module |
| `WEBHOOK_URL` | — | Single webhook URL for all events. Payload includes an `event` field (`result_updated`, `prediction_changed`, `leader_change`, or `count_completed`) plus the full electorate result and a `diff` describing what changed. |
| `WEBHOOK_LOG_PORT` | `3458` | Port for the local `npm run log:webhooks` receiver |
| `MOCK_PORT` | `3457` | Port for the mock results server |
| `CACHE_PATH` | `.data/electorate_results.json` | Dashboard server JSON cache path |
| `FEED_CACHE_PATH` | `.data/feed_events.json` | Dashboard server feed-events cache path |
| `MAX_FEED_EVENTS` | `200` | Maximum feed events retained by the dashboard server |
| `DIST_DIR` | `./dist` | Directory the dashboard server serves static files from |
| `OPENAI_API_KEY` | — | API key for the `discover` subcommand |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL for the LLM used by `discover` |
| `LLM_MODEL` | `gpt-4o` | Model used by `discover` |

## Deployment

### Docker

```bash
docker build -t election-night .
docker run -p 3456:3456 election-night
```

The container bundles the dashboard, starts the web server, and then starts the scraper (see `deploy/entrypoint.sh`).

### Fly.io

The included `fly.toml` deploys the web server + scraper to Fly.io. PR previews are automatically deployed via the `.github/workflows/preview.yml` workflow.

Note: `fly.toml` references a persistent volume for `.data` that is commented out; uncomment the `[[mounts]]` block after creating the volume with `fly volumes create election_data --region nrt --size 1`.

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
