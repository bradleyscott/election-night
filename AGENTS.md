# AGENTS.md

Compact instructions for working in this repo. When in doubt, trust executable config over prose.

## Repo shape

- npm-workspace monorepo: `packages/core`, `packages/collector`, `packages/dashboard`.
- All packages are ESM (`"type": "module"`).
- `@election-night/core` is compiled to `dist/` (`main` points at `./dist/index.js`) and must be built before the collector, server, or dashboard dev mode can use it. Root `prepare` runs `npm run build:core`.
- Collector and server run TypeScript directly via `tsx`; there is no compiled `dist` for `collector` at runtime.
- `packages/dashboard` is a Vite React app with its own Node Socket.io server (`server/index.ts`).

## Design system

- The dashboard's locked design system lives in `design.md` (genre: editorial / Newsprint printed-edition: Playfair Display + Crimson Pro + Inter + IBM Plex Mono, hairline panels, masthead red accent, OS colour mode). The token source of truth is `packages/dashboard/src/styles/index.css` (shadcn-compatible HSL vars + `pagehead` / `chip-print` / `stat-grid` utilities). Follow it when touching dashboard UI; amendments go in `design.md`, not in per-page hacks.

## Quick commands

Run these from the repo root unless noted.

```bash
# Build the shared core package (required before most other commands)
npm run build:core

# Run the collector against the official XML feed
ELECTION_YEAR=2023 npm run start:collector

# Web dev (starts Socket.io server + Vite concurrently)
npm run dev

# Run the collector CLI
npm run start:collector

# Run the Socket.io / dashboard server only
npm run start:server

# Mock XML results server (serves candidates/parties/electorates + e{NN}.xml)
npm run start:mock
# Advance the stage manually:
# curl -X POST http://localhost:3457/advance
# Reset to the first stage:
# curl -X POST http://localhost:3457/reset
# Or auto-step every N ms:
# npm run start:mock -- --auto-step 15000
# Other flags: --port 3457 (or MOCK_PORT), --stage early|mid|late|full, --help

# Then point the collector at the mock feed:
# XML_FEED_BASE_URL=http://localhost:3457/ POLL_INTERVAL_MS=15000 npm run start:collector

# Truncate the SQLite DB and delete JSON caches
npm run clear

# Start a local webhook receiver on port 3458
npm run log:webhooks

# Verification
npm run lint          # eslint packages/
npm run typecheck     # tsc -b for core + collector, plus packages/dashboard
npm test              # vitest
npm run fmt           # prettier --write .
```

## Package entrypoints and boundaries

- `packages/core/src/index.ts` — shared types, config, reducers, and source adapters. `ElectionSource` is async and self-fetching: `getName()`, `loadElectorates()`, `loadPartyList()`, `fetchResults(config)`. There is no browser or context in the contract; implementations must set `party` on each candidate vote.
- `packages/core/src/sources/index.ts` — exports the built-in `NzElectionXmlSource`.
- `packages/core/src/sources/nz-election-xml.ts` — the only built-in source. Fetches `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml` from `https://electionresults.govt.nz/electionresults_{YEAR}/xml/` over plain HTTPS. Year from `ELECTION_YEAR`; full URL override via `XML_FEED_BASE_URL`. No browser.
- `packages/collector/src/index.ts` — main loop. Fetches the feed, calculates predictions, writes to SQLite, publishes results via a Socket.io client, and serves health/history.
- `packages/collector/src/serve-mock.ts` — mock XML feed server. Serves `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml` from evolving synthetic stages, so the full pipeline can run offline via `XML_FEED_BASE_URL`.
- `packages/collector/src/clear.ts` — truncates the SQLite database and removes the JSON results cache.
- `packages/collector/src/log-webhooks.ts` — local HTTP server that pretty-prints incoming webhook payloads.
- `packages/collector/src/source-loader.ts` — loads a custom `ElectionSource` from `ELECTION_SOURCE_PATH` or falls back to `NzElectionXmlSource`.
- `packages/collector/src/health.ts` / `packages/collector/src/history-server.ts` — the collector's HTTP surface on `HEALTH_PORT`: `/health` live state and `/history/*` REST endpoints reading the collector's SQLite DB (public, unauthenticated; rate limiting is the reverse proxy's job). This is the **only** source of history data.
- `packages/dashboard/server/index.ts` — Socket.io server. Receives results from the collector, broadcasts to web clients, serves the built Vite app, and exposes `/health`, `/ready`, `/metrics`, `/api/clear` (optionally guarded by `CLEAR_TOKEN`), and `/api/history/*` endpoints. Split into `static.ts` (static/SPA serving), `api.ts` (history routes), and `feed.ts` (diff → feed-event generation and copy).
- `packages/core/src/diff.ts` — shared scrape-to-scrape diff and webhook/feed event classification, used by both the collector and the dashboard server. `packages/core/src/history.ts` holds the `/history/*` response types shared by collector, server, and frontend.
- `packages/dashboard/server/history-upstream.ts` — the dashboard server's history API client; fetches `/history/*` from the collector over HTTP with a short response cache. No local DB fallback exists by design. In the combined deployment this is loopback.
- `packages/dashboard/server/seed.ts` — generates synthetic seed data for manual testing.
- `packages/dashboard/src/main.tsx` — React frontend entrypoint (Vite, Tailwind, Leaflet, react-router-dom, Recharts).

## Architecture notes that aren't obvious from filenames

- **Core is built.** `packages/core` ships compiled JS from `dist/`. Root scripts run `npm run build:core` before starting the collector or dashboard. `npm install` triggers `prepare` which also builds core.
- **Socket.io is the backbone.** The collector is a Socket.io _client_; the dashboard package runs the _server_. The server listens on `WS_PORT` (default `3456`). Dashboard `index.html` hardcodes a `preconnect` to `http://localhost:3456`.
- **The results source is the official XML feed.** `NzElectionXmlSource` reads `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml`. The feed supplies candidate names, party mapping, and party list rankings directly, so there are no static CSV data files and no HTML parsing. The feed is a Cloudflare-cached static asset that is reachable from datacenter egress — see `docs/deployment-simplification.md`.
- **No browser anywhere.** `cloakbrowser`, `playwright-core`, `cheerio`, and the HTML scraping path were removed. Do not reintroduce a browser into the collector without a matching plan update.
- **`calculateLead(results)` resolves party from each candidate.** There is no separate name→party map. Custom sources must populate `party` on `RawElectorateResults.candidateVotes`.
- **Dashboard is NOT part of root `tsc -b` references.** Root `tsconfig.json` only references `core` and `collector`. `dashboard` typechecks via its own `tsc -b` inside `npm run build` and in `npm run typecheck`.
- **SQLite + Drizzle ORM.** Collector uses `better-sqlite3` (native dependency). The DB path defaults to `./.data/election_results.db`. Migrations live in `packages/collector/drizzle/` and auto-run on startup via `migrate()` in `db.ts`. Drizzle config is at `packages/collector/drizzle.config.ts`.
- **The dashboard server never opens a database.** The collector owns SQLite; the server fetches history from the collector's `/history/*` REST API (`HISTORY_UPSTREAM`, default loopback) and relies on Socket.io for live results.
- **Environment loading.** Collector and dashboard server entrypoints import `dotenv/config`. Expected variables:
  - Source: `ELECTION_YEAR` (default `2023`; builds the XML feed URL), `XML_FEED_BASE_URL` (optional full override, must end with `/`; used to point at the mock server)
  - Webhooks: `WEBHOOK_URL` (single URL; payload includes an `event` field to discriminate type), `WEBHOOK_LOG_PORT` (default `3458`)
  - Runtime: `POLL_INTERVAL_MS` (default 120s), `CONCURRENCY` (default 10), `FETCH_TIMEOUT_MS` (default 30s), `FETCH_PACING_MS` (default 300; jittered delay between electorate fetches), `HEALTH_PORT` (default 3459; collector health/live-state endpoint + unauthenticated `/history/*` REST API — rate limit at the proxy when publicly exposed), `LOG_LEVEL` (0=silly, 1=trace, 2=debug, 3=info), `WS_PORT`/`WS_URL`, `WS_RECONNECT_DELAY_MS` (default 2s), `DB_PATH` (default `.data/election_results.db`), `RESULTS_CACHE_PATH` (default `.data/electorate_results.json`; JSON cache of last-cycle electorate results used as the webhook diff baseline), `ELECTION_SOURCE_PATH`, `COLLECTOR_ENABLED` (combined image: set `false` to run the dashboard server alone)
  - Mock: `MOCK_PORT` (default `3457`)
  - Web server: `DIST_DIR` (default `./dist`), `CACHE_PATH` (default `.data/electorate_results.json`), `FEED_CACHE_PATH` (default `.data/feed_events.json`), `MAX_FEED_EVENTS` (default `200`), `CLEAR_TOKEN` (optional; when set, `POST /api/clear` requires it in the `x-clear-token` header), `HISTORY_UPSTREAM` (dashboard server: base URL of the collector's history REST API — always used, defaults to `http://127.0.0.1:3459` for a co-located collector)
- **Custom source adapters.** Set `ELECTION_SOURCE_PATH` to a JS/TS module exporting a class implementing `ElectionSource` (or `NzElectionXmlSource`). The module must set `party` on candidate votes.

## Toolchain and style quirks

- ESLint ignores `**/components/ui/**`, `**/dist/**`, `**/node_modules/**`, `**/.cache/**`, and `**/.data/**`.
- Prettier config: `singleQuote: true`, `trailingComma: es5`.
- ESLint disables `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-empty-function`, `@typescript-eslint/no-shadow`, and `no-console` globally. Unused vars are warned on except function arguments.
- Tailwind dark mode is `class` based; `index.html` sets `<html class="dark">`.

## Testing

- Vitest runs `packages/*/src/**/*.test.{ts,tsx}` from the root.
- `packages/dashboard/src/test/setup.ts` stubs `ResizeObserver` and `window.matchMedia` for component tests.
- `packages/collector/src/pipeline.test.ts` runs the full collector → Socket.io → dashboard → SQLite path against the mock XML server.
- No special setup or services required; tests are self-contained.

## Gotchas

- `@election-night/core` must be built before running the collector or dashboard. If you see module-resolution errors, run `npm run build:core`.
- `better-sqlite3` is a native Node dependency. If installation fails, the environment likely needs build tools (Python, a C++ compiler).
- The collector creates `.data/` automatically for the SQLite DB and JSON results cache. In the Fly deployment these paths point at the `/data` volume.
- The dashboard server serves the built Vite bundle from `DIST_DIR` in production. For local dev, `npm run dev` starts both the server and the Vite dev server.
- Mock server (`serve-mock.ts`) serves mock XML that matches the Electoral Commission feed schema, so the collector and the prediction pipeline run exactly as they do against the real feed.

## Deployment

- Production is a **single Fly.io app** (`fly.toml` + `Dockerfile.app`): the dashboard server (public, `:3456`) and the collector (loopback, `:3459`) run together from `docker/entrypoint.sh`. The collector talks to the server over loopback (`WS_URL=ws://127.0.0.1:3456`, `HISTORY_UPSTREAM=http://127.0.0.1:3459`). SQLite and the caches live on the `/data` volume.
- The collector polls a cached static XML asset that is reachable from datacenter egress, so it no longer needs a residential connection or proxy. `Dockerfile.collector` remains for running the collector standalone.
- PR previews use `fly.preview.toml` (no volume, `COLLECTOR_ENABLED=false`) so they never poll the live feed.
- CI: `.github/workflows/deploy.yml` deploys `main` to Fly, gated on `checks.yml` (lint/typecheck/test) and `security.yml`; `preview.yml` deploys per-PR preview apps.
