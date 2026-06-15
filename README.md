![Election Night Logo](./packages/dashboard/public/favicon.svg)

# Election Night — NZ General Election Result Tracker

This started as a project for a 2023 election night party — the goal was to avoid manual data entry for a "guess the result" game. It's since grown into a full real-time election night results platform that scrapes the NZ Electoral Commission site, calculates seat projections, and serves an interactive dashboard.

## Features

- **Automated scraping** — Uses Puppeteer + stealth to pull results from the [official NZ Electoral Commission site](https://electionresults.govt.nz/) as they're published.
- **Race calling** — Predicts winners per electorate with confidence levels (`too-close`, `leaning`, `likely`, `projected`) using statistical margin analysis.
- **Seat projections** — Allocates list seats via the Sainte-Laguë method to project the final parliament makeup.
- **Interactive web dashboard** — Built with React, Vite, Leaflet, and Tailwind. Includes:
  - Electorate map with colour-coded results
  - Seat count and party vote breakdown
  - Per-electorate results pages
  - "Close calls" view
  - Live feed / commentary timeline
- **Real-time** — Socket.io broadcasts results from the scraper to all connected web clients instantly.
- **Webhook notifications** — Configurable webhooks for new predictions, updated results, and leader changes (e.g., smart home integrations).
- **Persistence** — SQLite database via Drizzle ORM caches results for crash recovery and historical tracking.
- **Mock server** — A built-in mock results server that serves evolving HTML for development and testing.
- **Custom source adapters** — Pluggable interface to adapt the scraper for non-NZ election sites.

## Architecture

```
election-night/
├── packages/
│   ├── core/          # Shared types, config, reducers, source adapters (raw .ts)
│   ├── collector/     # Scraper CLI + mock server (Puppeteer, Cheerio, SQLite)
│   └── dashboard/     # Vite React app + Socket.io server (Leaflet, Tailwind)
├── csv/               # Electorate, candidate, and party list data
└── .data/             # SQLite DB + cached JSON (auto-created at runtime)
```

**Socket.io is the backbone.** The collector acts as a Socket.io *client*; the dashboard package runs the Socket.io *server*. The server also serves the built Vite app and caches results to disk, so the dashboard works even if the scraper restarts.

```
┌─────────────────┐  Socket.io  ┌────────────────────┐
│   Collector     │ ──────────> │  Dashboard server  │
│   Puppeteer     │  results +  │  Socket.io server  │
│   SQLite        │  feed events│  + static files    │
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

```bash
# Install dependencies (requires build tools for better-sqlite3)
npm install

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
| `npm run dev` | Start web server + Vite dev server concurrently |
| `npm run start:collector` | Run the scraper CLI |
| `npm run start:server` | Start Socket.io server only |
| `npm run start:mock` | Start mock election results server |
| `npm test` | Run Vitest test suite |
| `npm run lint` | ESLint all packages |
| `npm run typecheck` | TypeScript type checking |
| `npm run fmt` | Prettier format |

### Mock server

The mock server simulates an evolving election night. Advance stages manually or auto-step:

```bash
# Auto-step every 15 seconds starting from 'early' stage
npm run start:mock -- --auto-step 15000 --stage early

# Advance stage manually
curl -X POST http://localhost:3457/advance
```

Other flags: `--port 3457`, `--help`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BASE_RESULTS_URL` | — | URL of the election results site |
| `POLL_INTERVAL_MS` | `120000` | Time between scrape polls |
| `CONCURRENCY` | `10` | Parallel page scrapes |
| `NAVIGATION_TIMEOUT_MS` | `60000` | Puppeteer navigation timeout |
| `WS_PORT` | `3456` | Socket.io server port |
| `WS_URL` | — | Socket.io server URL (for collector) |
| `DB_PATH` | `./.data/election_results.db` | SQLite database path |
| `ELECTION_SOURCE_PATH` | — | Path to a custom source adapter module |
| `WEBHOOK_URL` | — | Single webhook URL for all events. Payload includes an `event` field (`result_updated`, `prediction_changed`, `leader_change`, or `count_completed`) plus the full electorate result and a `diff` describing what changed. |
| `LOG_LEVEL` | `3` | Log verbosity (0=silly, 1=trace, 2=debug, 3=info) |
| `RESULTS_TABLE_SELECTOR` | — | Cheerio selector for results table |
| `CANDIDATE_TABLE_SELECTOR` | — | Cheerio selector for candidate table |
| `PARTY_VOTE_TABLE_SELECTOR` | — | Cheerio selector for party vote table |
| `VOTE_PERCENT_COUNTED_SELECTOR` | — | Cheerio selector for % counted |
| `VOTES_COUNTED_SELECTOR` | — | Cheerio selector for votes counted |

## Deployment

### Docker

```bash
docker build -t election-night .
docker run -p 3456:3456 election-night
```

### Fly.io

The included `fly.toml` deploys the web server to Fly.io. PR previews are automatically deployed via the `.github/workflows/preview.yml` workflow.

## Custom Source Adapters

Set `ELECTION_SOURCE_PATH` to a JS/TS module that exports a class implementing the `ElectionSource` interface (see `packages/core/src/types.ts`). This lets you adapt the scraper for non-NZ election result sites.

## Data Files

CSV files in `csv/` are read at runtime:

- `electorates.csv` — Electorate names, boundaries, and metadata
- `candidates.csv` — Candidate names, parties, and electorates
- `party_list.csv` — Party list rankings for list MP allocation
