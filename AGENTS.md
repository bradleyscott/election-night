# AGENTS.md

Compact instructions for working in this repo. When in doubt, trust executable config over prose.

## Repo shape

- npm-workspace monorepo: `packages/core`, `packages/collector`, `packages/dashboard`.
- All packages are ESM (`"type": "module"`).
- Collector and server run TypeScript directly via `tsx`; there is no compiled `dist` for `core` or `collector` at runtime. `core` is consumed as raw `.ts` source (its `package.json` points `main` at `./src/index.ts`).
- `packages/dashboard` is a Vite React app with its own Node Socket.io server (`server/index.ts`).

## Quick commands

Run these from the repo root unless noted.

```bash
# Web dev (starts Socket.io server + Vite concurrently)
npm run dev

# Run the scraper CLI
npm run start:collector

# Run the Socket.io server only
npm run start:server

# Mock election results server (evolving HTML served to the scraper)
npm run start:mock
# Advance the stage manually:
# curl -X POST http://localhost:3457/advance
# Or auto-step every N ms:
# npm run start:mock -- --auto-step 15000
# Other flags: --port 3457, --stage early|mid|late|full, --help

# Then scrape from the mock server:
# BASE_RESULTS_URL=http://localhost:3457 POLL_INTERVAL_MS=15000 npm run start:collector

# Verification
npm run lint          # eslint packages/
npm run typecheck     # tsc -b (only core + collector; dashboard is NOT in root tsconfig references)
npm test              # vitest
npm run fmt           # prettier --write .
```

## Package entrypoints and boundaries

- `packages/core/src/index.ts` — shared types, config, reducers, and source adapters.
- `packages/collector/src/index.ts` — main scraper loop. Scrapes NZ Electoral Commission site with Puppeteer + stealth, calculates predictions, writes to SQLite, and publishes results via Socket.io client.
- `packages/collector/src/serve-mock.ts` — mock election results website; serves evolving HTML that the scraper fetches via Puppeteer. Replaces the old synthetic data approach.
- `packages/collector/src/discover.ts` — `discover` subcommand loaded dynamically when `process.argv[2] === 'discover'`.
- `packages/dashboard/server/index.ts` — Socket.io server. Receives results from the collector and broadcasts to web clients. Loads cached results from `.data/electorate_results.json` on startup.
- `packages/dashboard/src/main.tsx` — React frontend entrypoint (Vite, Tailwind, Leaflet, react-router-dom).

## Architecture notes that aren't obvious from filenames

- **Socket.io is the backbone.** The collector is a Socket.io *client*; the dashboard package runs the *server*. The server listens on `WS_PORT` (default `3456`). Dashboard `index.html` hardcodes a `preconnect` to `http://localhost:3456`.
- **Dashboard is NOT part of root `tsc -b`.** Root `tsconfig.json` only references `core` and `collector`. `dashboard` typechecks via its own `tsc -b` inside `npm run build`.
- **SQLite + Drizzle ORM.** Collector uses `better-sqlite3` (native dependency). The DB path defaults to `./.data/election_results.db`. Migrations live in `packages/collector/drizzle/` and auto-run on startup via `migrate()` in `db.ts`. Drizzle config is at `packages/collector/drizzle.config.ts`.
- **Static CSV data.** `csv/candidates.csv`, `csv/electorates.csv`, and `csv/party_list.csv` are read at runtime by the collector. They are not bundled.
- **Environment loading.** Collector entrypoints import `dotenv/config`. Expected variables:
  - Scraping: `BASE_RESULTS_URL`, `RESULTS_TABLE_SELECTOR`, `CANDIDATE_TABLE_SELECTOR`, `PARTY_VOTE_TABLE_SELECTOR`, `VOTE_PERCENT_COUNTED_SELECTOR`, `VOTES_COUNTED_SELECTOR`
  - Webhooks: `WEBHOOK_URL` (single URL; payload includes an `event` field to discriminate type)
  - Runtime: `POLL_INTERVAL_MS` (default 120s), `CONCURRENCY` (default 10), `NAVIGATION_TIMEOUT_MS` (default 60s), `LOG_LEVEL` (0=silly, 1=trace, 2=debug, 3=info), `WS_PORT`/`WS_URL`, `WS_RECONNECT_DELAY_MS` (default 2s), `DB_PATH`, `ELECTION_SOURCE_PATH`
  - Discover subcommand: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `LLM_MODEL` (default `gpt-4o`)
  - Web server: `DIST_DIR` (default `./dist`)
- **Custom source adapters.** Set `ELECTION_SOURCE_PATH` to a JS/TS module exporting `default` or `NzElectionResultsSource`. Used to adapt to other election result sites.

## Toolchain and style quirks

- ESLint ignores `**/components/ui/**` in addition to the usual `dist/` and `node_modules/`.
- Prettier config: `singleQuote: true`, `trailingComma: es5`.
- ESLint disables `@typescript-eslint/no-explicit-any`, `no-empty-function`, `no-shadow`, and `no-console` globally.
- Tailwind dark mode is `class` based; `index.html` sets `<html class="dark">`.

## Testing

- Vitest runs `packages/*/src/**/*.test.ts` from the root. No special setup or services required; tests are self-contained.

## Gotchas

- `better-sqlite3` is a native Node dependency. If installation fails, the environment likely needs build tools (Python, a C++ compiler).
- Puppeteer downloads Chromium on install; the collector uses `puppeteer-extra-plugin-stealth`.
- The collector creates `.data/` automatically for the SQLite DB and JSON results cache.
- Mock server (`serve-mock.ts`) serves HTML matching the NZ Electoral Commission site structure. The real scraper fetches it via Puppeteer, parses it with Cheerio, and runs the full prediction pipeline — same as election night.
