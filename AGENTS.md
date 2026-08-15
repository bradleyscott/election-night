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

# Web dev (starts Socket.io server + Vite concurrently)
npm run dev

# Run the scraper CLI
npm run start:collector

# Run the Socket.io / dashboard server only
npm run start:server

# Mock election results server (evolving HTML served to the scraper)
npm run start:mock
# Advance the stage manually:
# curl -X POST http://localhost:3457/advance
# Reset to the first stage:
# curl -X POST http://localhost:3457/reset
# Or auto-step every N ms:
# npm run start:mock -- --auto-step 15000
# Other flags: --port 3457 (or MOCK_PORT), --stage early|mid|late|full, --help

# Then scrape from the mock server:
# BASE_RESULTS_URL=http://localhost:3457 POLL_INTERVAL_MS=15000 npm run start:collector

# Truncate the SQLite DB and delete JSON caches
npm run clear

# Start a local webhook receiver on port 3458
npm run log:webhooks

# Discover a custom source adapter from a sample results page
# OPENAI_API_KEY=sk-... npm run start:collector -- discover --url <url> [--output <name>]

# Verification
npm run lint          # eslint packages/
npm run typecheck     # tsc -b for core + collector, plus packages/dashboard
npm test              # vitest
npm run fmt           # prettier --write .
```

## Package entrypoints and boundaries

- `packages/core/src/index.ts` — shared types, config, reducers, and source adapters.
- `packages/core/src/sources/index.ts` — exports available source adapters (currently `NzElectionResultsSource`).
- `packages/collector/src/index.ts` — main scraper loop. Scrapes results with Playwright via `cloakbrowser` (stealth Chromium), calculates predictions, writes to SQLite, and publishes results via Socket.io client.
- `packages/collector/src/serve-mock.ts` — mock election results website; serves evolving HTML that the scraper fetches through the same stealth-Chromium pipeline as the real site.
- `packages/collector/src/discover.ts` — `discover` subcommand loaded dynamically when `process.argv[2] === 'discover'`. Generates a source adapter in `packages/core/src/sources/`.
- `packages/collector/src/clear.ts` — truncates the SQLite database and removes the JSON results cache.
- `packages/collector/src/log-webhooks.ts` — local HTTP server that pretty-prints incoming webhook payloads.
- `packages/collector/src/source-loader.ts` — loads a custom `ElectionSource` from `ELECTION_SOURCE_PATH` or falls back to `NzElectionResultsSource`.
- `packages/collector/src/health.ts` / `packages/collector/src/history-server.ts` — the collector's HTTP surface on `HEALTH_PORT`: `/health` live state and `/history/*` REST endpoints reading the collector's SQLite DB (public, unauthenticated; rate limiting is the reverse proxy's job). This is the **only** source of history data.
- `packages/dashboard/server/index.ts` — Socket.io server. Receives results from the collector, broadcasts to web clients, serves the built Vite app, and exposes `/health`, `/ready`, `/metrics`, `/api/clear` (optionally guarded by `CLEAR_TOKEN`), and `/api/history/*` endpoints. Split into `static.ts` (static/SPA serving), `api.ts` (history routes), and `feed.ts` (diff → feed-event generation and copy).
- `packages/core/src/diff.ts` — shared scrape-to-scrape diff and webhook/feed event classification, used by both the collector and the dashboard server. `packages/core/src/history.ts` holds the `/history/*` response types shared by collector, server, and frontend.
- `packages/dashboard/server/history-upstream.ts` — the dashboard server's history API client; fetches `/history/*` from the collector over HTTP with a short response cache. No local DB fallback exists by design.
- `packages/dashboard/server/seed.ts` — generates synthetic seed data for manual testing.
- `packages/dashboard/src/main.tsx` — React frontend entrypoint (Vite, Tailwind, Leaflet, react-router-dom, Recharts).

## Architecture notes that aren't obvious from filenames

- **Core is built.** `packages/core` ships compiled JS from `dist/`. Root scripts run `npm run build:core` before starting the collector or dashboard. `npm install` triggers `prepare` which also builds core.
- **Socket.io is the backbone.** The collector is a Socket.io _client_; the dashboard package runs the _server_. The server listens on `WS_PORT` (default `3456`). Dashboard `index.html` hardcodes a `preconnect` to `http://localhost:3456`.
- **Browser automation uses `cloakbrowser` + `playwright-core`.** The collector launches the stealth Chromium via `cloakbrowser` (the Playwright variant; the Puppeteer variant was dropped because its CDP protocol leaks automation signals). It opens one shared `BrowserContext` per cycle so a solved `cf_clearance` cookie rides across all electorate fetches; `cloakbrowser install` is run during Docker builds.
- **Dashboard is NOT part of root `tsc -b` references.** Root `tsconfig.json` only references `core` and `collector`. `dashboard` typechecks via its own `tsc -b` inside `npm run build` and in `npm run typecheck`.
- **SQLite + Drizzle ORM.** Collector uses `better-sqlite3` (native dependency). The DB path defaults to `./.data/election_results.db`. Migrations live in `packages/collector/drizzle/` and auto-run on startup via `migrate()` in `db.ts`. Drizzle config is at `packages/collector/drizzle.config.ts`.
- **The dashboard server never opens a database.** The collector owns SQLite; the server fetches history from the collector's `/history/*` REST API (`HISTORY_UPSTREAM`, default loopback) for live results it relies on Socket.io.
- **Static CSV data.** `csv/candidates.csv`, `csv/electorates.csv`, and `csv/party_list.csv` are read at runtime by the collector. They are not bundled.
- **Environment loading.** Collector and dashboard server entrypoints import `dotenv/config`. Expected variables:
  - Scraping: `BASE_RESULTS_URL`, `RESULTS_TABLE_SELECTOR`, `CANDIDATE_TABLE_SELECTOR`, `PARTY_VOTE_TABLE_SELECTOR`, `VOTE_PERCENT_COUNTED_SELECTOR`, `VOTES_COUNTED_SELECTOR`
  - Webhooks: `WEBHOOK_URL` (single URL; payload includes an `event` field to discriminate type), `WEBHOOK_LOG_PORT` (default `3458`)
  - Runtime: `POLL_INTERVAL_MS` (default 120s), `CONCURRENCY` (default 10), `NAVIGATION_TIMEOUT_MS` (default 120s; per-page goto/networkIdle timeout — bumped from 60s so Cloudflare managed challenges can complete), `FETCH_PACING_MS` (default 300; jittered delay between electorate fetches to avoid rate-limit bursts), `CHALLENGE_WARMUP_TIMEOUT_MS` (default 180s; per-attempt timeout when solving the Cloudflare challenge at browser launch), `CHALLENGE_WARMUP_MAX_ATTEMPTS` (default 3), `CHALLENGE_WARMUP_ENABLED` (default `true`; set `false` to skip the warm-up on trusted egress), `HEALTH_PORT` (default 3459; collector health/live-state endpoint + unauthenticated `/history/*` REST API — rate limit at the proxy when publicly exposed), `LOG_LEVEL` (0=silly, 1=trace, 2=debug, 3=info), `WS_PORT`/`WS_URL`, `WS_RECONNECT_DELAY_MS` (default 2s), `DB_PATH` (default `.data/election_results.db`), `RESULTS_CACHE_PATH` (default `.data/electorate_results.json`; JSON cache of last-cycle electorate results used as the webhook diff baseline), `ELECTION_SOURCE_PATH`
  - Browser tuning: `CLOAKBROWSER_PROXY` (proxy URL for alternate egress, e.g. a residential proxy `http://user:pass@host:port` — the site WAF-blocks datacenter IPs, so the collector usually needs this or a home connection), `CLOAKBROWSER_GEOIP` (default `false`; `true` matches timezone/locale/WebRTC to the exit IP), `CLOAKBROWSER_HUMANIZE` (default `true`; human-like mouse/keyboard/scroll), `CLOAKBROWSER_HEADLESS` (default `true`; set `false` for headed mode — needs a display, e.g. Xvfb on servers)
  - Mock: `MOCK_PORT` (default `3457`)
  - Discover subcommand: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `LLM_MODEL` (default `gpt-4o`)
  - Web server: `DIST_DIR` (default `./dist`), `CACHE_PATH` (default `.data/electorate_results.json`), `FEED_CACHE_PATH` (default `.data/feed_events.json`), `MAX_FEED_EVENTS` (default `200`), `CLEAR_TOKEN` (optional; when set, `POST /api/clear` requires it in the `x-clear-token` header), `HISTORY_UPSTREAM` (dashboard server: base URL of the collector's history REST API — always used, defaults to `http://127.0.0.1:3459` for a co-located collector)
- **Custom source adapters.** Set `ELECTION_SOURCE_PATH` to a JS/TS module exporting `default` or `NzElectionResultsSource`. Used to adapt to other election result sites. The `discover` subcommand generates these files into `packages/core/src/sources/`.

## Toolchain and style quirks

- ESLint ignores `**/components/ui/**`, `**/dist/**`, `**/node_modules/**`, `**/.cache/**`, and `**/.data/**`.
- Prettier config: `singleQuote: true`, `trailingComma: es5`.
- ESLint disables `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-empty-function`, `@typescript-eslint/no-shadow`, and `no-console` globally. Unused vars are warned on except function arguments.
- Tailwind dark mode is `class` based; `index.html` sets `<html class="dark">`.

## Testing

- Vitest runs `packages/*/src/**/*.test.{ts,tsx}` from the root.
- `packages/dashboard/src/test/setup.ts` stubs `ResizeObserver` and `window.matchMedia` for component tests.
- No special setup or services required; tests are self-contained.

## Gotchas

- `@election-night/core` must be built before running the collector or dashboard. If you see module-resolution errors, run `npm run build:core`.
- `better-sqlite3` is a native Node dependency. If installation fails, the environment likely needs build tools (Python, a C++ compiler).
- `cloakbrowser` manages the browser binary; run `npx cloakbrowser install` manually if the stealth Chromium can't be found.
- The collector creates `.data/` automatically for the SQLite DB and JSON results cache.
- The dashboard server serves the built Vite bundle from `DIST_DIR` in production. For local dev, `npm run dev` starts both the server and the Vite dev server.
- Mock server (`serve-mock.ts`) serves HTML matching the NZ Electoral Commission site structure. The real scraper fetches it via cloakbrowser, parses it with Cheerio, and runs the full prediction pipeline — same as election night.

## Deployment

- Production is split: the **dashboard server runs on Fly.io** (`fly.toml` + `Dockerfile`, a server-only image — no browser, no SQLite) and the **collector runs on a homelab LXC via Coolify** (`Dockerfile.collector`). The collector publishes to the cloud server over Socket.io (`WS_URL`) and serves `/history/*` on port 3459, which the cloud server reads via `HISTORY_UPSTREAM`.
- CI: `.github/workflows/deploy.yml` deploys `main` to Fly, gated on `checks.yml` (lint/typecheck/test) and `security.yml`; `preview.yml` deploys per-PR preview apps.
