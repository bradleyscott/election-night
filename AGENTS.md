# AGENTS.md

Compact instructions for working in this repo. When in doubt, trust executable config over prose.

## Repo shape

- npm-workspace monorepo: `packages/core`, `packages/collector`, `packages/dashboard`.
- All packages are ESM (`"type": "module"`).
- `@election-night/core` is compiled to `dist/` (`main` points at `./dist/index.js`) and must be built before the collector, server, or dashboard dev mode can use it. Root `prepare` runs `npm run build:core`.
- The collector is consumed as TypeScript source (`@election-night/collector` resolves to `src/index.ts`) and is run **in-process by the dashboard server**. Nothing is compiled except `core`; everything runs through `tsx`.
- `packages/dashboard` is a Vite React app plus the Node server (`server/index.ts`) that serves it, owns Socket.io, and runs the collector loop.

## Design system

- The dashboard's locked design system lives in `design.md` (genre: editorial / Newsprint printed-edition: Playfair Display + Crimson Pro + Inter + IBM Plex Mono, hairline panels, masthead red accent, OS colour mode). The token source of truth is `packages/dashboard/src/styles/index.css` (shadcn-compatible HSL vars + `pagehead` / `chip-print` / `stat-grid` utilities). Follow it when touching dashboard UI; amendments go in `design.md`, not in per-page hacks.

## Quick commands

Run these from the repo root unless noted.

```bash
# Build the shared core package (required before most other commands)
npm run build:core

# Web dev — server + in-process collector on :3456, plus Vite on :5173
npm run dev

# Server + collector without Vite
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

# Then point the in-process collector at the mock feed and watch it advance:
# XML_FEED_BASE_URL=http://localhost:3457/ POLL_INTERVAL_MS=15000 npm run start:server

# Truncate the SQLite DB
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
- `packages/collector/src/index.ts` — the library entrypoint: re-exports `startCollector`/`stopCollector`/`collectorState` (`collector.ts`), `createResultsDb` (`query.ts`) and `collectorConfig`.
- `packages/collector/src/collector.ts` — the polling loop, as a library. Loads the source (retrying until the feed is reachable), writes a snapshot, diffs against the previous snapshot read from SQLite, then hands the payload to `onResults`. It has no HTTP server and no Socket.io client of its own.
- `packages/collector/src/query.ts` — read-only SQL. Serves the `/api/history/*` payloads and `latestPayload()`, which reconstructs the newest snapshot in full. The dashboard server uses it for history and for its boot state; the collector uses it as the webhook diff baseline.
- `packages/collector/src/serve-mock.ts` — mock XML feed server. Serves `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml` from evolving synthetic stages, so the full pipeline can run offline via `XML_FEED_BASE_URL`. `--year 2023|2026` (or `MOCK_ELECTION_YEAR`) picks which cycle's electorate list to replay; `packages/collector/src/synthetic-electorates.ts` holds both lists and is asserted against the dashboard boundary manifest, so a replay cannot serve an electorate the map has no polygon for.
- `packages/collector/src/clear.ts` — truncates the SQLite database.
- `packages/collector/src/log-webhooks.ts` — local HTTP server that pretty-prints incoming webhook payloads.
- `packages/collector/src/source-loader.ts` — loads a custom `ElectionSource` from `ELECTION_SOURCE_PATH` or falls back to `NzElectionXmlSource`.
- `packages/dashboard/server/index.ts` — the single process. Owns the Socket.io server, starts the collector in-process (unless `COLLECTOR_ENABLED=false`), broadcasts payloads to browsers, seeds live state from the newest snapshot on boot, and exposes `/health`, `/ready`, `/metrics`, `/api/clear` (optionally guarded by `CLEAR_TOKEN`) and `/api/history/*`. Split into `static.ts` (static/SPA serving), `api.ts` (history routes), `health.ts` (health/ready/metrics), `ready-check.ts` (pure readiness rules) and `feed.ts` (diff → feed-event generation and copy).
- `packages/core/src/diff.ts` — shared scrape-to-scrape diff and webhook/feed event classification, used by both the collector and the dashboard server. `packages/core/src/history.ts` holds the `/history/*` response types shared by collector, server, and frontend.
- `packages/dashboard/server/seed.ts` — generates synthetic seed data for manual testing.
- `packages/dashboard/src/main.tsx` — React frontend entrypoint (Vite, Tailwind, Leaflet, react-router-dom, Recharts).
- `packages/dashboard/public/boundaries/<year>/{general,maori}-electorates.geojson` — electorate boundary geometry, one directory per election cycle, plus a generated `index.json` manifest of electorate names per year. `packages/dashboard/src/lib/electorates.ts` holds the name normalisation and year-selection logic; `ElectorateMap.tsx` consumes both.
- `scripts/fetch-electorate-boundaries.mjs` — regenerates the boundary files from Stats NZ's public ArcGIS feature services (no API key) and rebuilds the manifest. Run it when a cycle's boundaries change.

## Architecture notes that aren't obvious from filenames

- **Core is built.** `packages/core` ships compiled JS from `dist/`. Root scripts run `npm run build:core` before starting the collector or dashboard. `npm install` triggers `prepare` which also builds core.
- **Socket.io carries results server → browser, and nothing else.** The collector used to be a Socket.io _client_ talking to the server; it now runs inside the server process and results reach the browser by direct call. The server listens on `WS_PORT` (default `3456`); dashboard `index.html` hardcodes a `preconnect` to `http://localhost:3456`.
- **The results source is the official XML feed.** `NzElectionXmlSource` reads `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml`. The feed supplies candidate names, party mapping, and party list rankings directly, so there are no static CSV data files and no HTML parsing. The feed is a Cloudflare-cached static asset that is reachable from datacenter egress — see `docs/deployment-simplification.md`.
- **No browser anywhere.** `cloakbrowser`, `playwright-core`, `cheerio`, and the HTML scraping path were removed. Do not reintroduce a browser into the collector without a matching plan update.
- **`calculateLead(results)` resolves party from each candidate.** There is no separate name→party map. Custom sources must populate `party` on `RawElectorateResults.candidateVotes`.
- **Dashboard is NOT part of root `tsc -b` references.** Root `tsconfig.json` only references `core` and `collector`. `dashboard` typechecks via its own `tsc -b` inside `npm run build` and in `npm run typecheck`.
- **SQLite + Drizzle ORM.** Collector uses `better-sqlite3` (native dependency). The DB path defaults to `./.data/election_results.db`. Migrations live in `packages/collector/drizzle/` and auto-run on startup via `migrate()` in `db.ts`. Drizzle config is at `packages/collector/drizzle.config.ts`.
- **One process owns the database.** `packages/collector/src/db.ts` writes snapshots and `query.ts` reads them, both against the same SQLite file in the same process. There is no history HTTP API and no JSON results cache: a snapshot is the only shared state, so what is served as history and what is used as the diff baseline cannot disagree.
- **Electorate boundaries are keyed by election year and matched by name.** Boundaries are redrawn most cycles: 2026 has 64 general electorates (down from 65) with 10 renamed or new and 11 gone. `selectBoundaryYear()` scores each year's manifest names against the electorates being rendered and uses the best match, so running against 2023 data still draws 2023 boundaries; `VITE_ELECTION_YEAR` pins the choice. Names are compared with macrons, case and punctuation stripped (`normalizeElectorateName`), because the Commission's feed and Stats NZ both publish macronised and ASCII variants. When results and polygons cannot be reconciled the map shows a "Boundary mismatch" banner naming them — never silently draw the wrong cycle. See `docs/2026-election-boundaries.md`.
- **History is scoped to one election cycle.** `scrape_snapshots.election_year` stores `ELECTION_YEAR` per snapshot and every query filters to the active year (with a `?year=` override), because the Fly deployment keeps SQLite on a persistent volume across cycles. There is no separate cache to mis-attribute: a cycle with no snapshots yet returns nothing rather than the previous cycle's results, so the first scrape of a new cycle cannot fire bogus events.
- **Environment loading.** Collector and dashboard server entrypoints import `dotenv/config`. Expected variables:
  - Source: `ELECTION_YEAR` (default `2023`; builds the XML feed URL), `XML_FEED_BASE_URL` (optional full override, must end with `/`; used to point at the mock server)
  - Webhooks: `WEBHOOK_URL` (single URL; payload includes an `event` field to discriminate type), `WEBHOOK_LOG_PORT` (default `3458`)
  - Runtime: `POLL_INTERVAL_MS` (default 30s; the feed is CDN-cached with `max-age` 30s and a full cycle takes ~1s), `CONCURRENCY` (default 10), `FETCH_TIMEOUT_MS` (default 5s; a hang guard — responses are ~13ms), `LOG_LEVEL` (0=silly, 1=trace, 2=debug, 3=info), `DB_PATH` (default `.data/election_results.db`), `ELECTION_SOURCE_PATH`, `COLLECTOR_ENABLED` (default `true`; `false` serves the last written snapshot without polling)
  - Mock: `MOCK_PORT` (default `3457`), `MOCK_ELECTION_YEAR` (default `2023`; the cycle the mock replays — `2026` uses the 64 + 7 2025 boundaries; `--year` overrides it)
  - Web server: `WS_PORT` (default `3456`), `DIST_DIR` (default `./dist`), `FEED_CACHE_PATH` (default `.data/feed_events.json`), `MAX_FEED_EVENTS` (default `200`), `CLEAR_TOKEN` (optional; when set, `POST /api/clear` requires it in the `x-clear-token` header)
  - Frontend: `VITE_WS_URL` (Socket.io URL override), `VITE_ELECTION_YEAR` (pin the electorate boundary dataset to an election year; unset = pick the year whose electorate names match the live results)
- **Custom source adapters.** Set `ELECTION_SOURCE_PATH` to a JS/TS module exporting a class implementing `ElectionSource` (or `NzElectionXmlSource`). The module must set `party` on candidate votes.

## Toolchain and style quirks

- ESLint ignores `**/components/ui/**`, `**/dist/**`, `**/node_modules/**`, `**/.cache/**`, and `**/.data/**`.
- Prettier config: `singleQuote: true`, `trailingComma: es5`.
- ESLint disables `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-empty-function`, `@typescript-eslint/no-shadow`, and `no-console` globally. Unused vars are warned on except function arguments.
- Tailwind dark mode is `class` based; `index.html` sets `<html class="dark">`.

## Testing

- Vitest runs `packages/*/src/**/*.test.{ts,tsx}` from the root.
- `packages/dashboard/src/test/setup.ts` stubs `ResizeObserver` and `window.matchMedia` for component tests.
- `packages/collector/src/synthetic-electorates.test.ts` asserts the mock's electorate lists match the boundary manifest the dashboard map draws from — for every supported cycle — plus the general/Māori split, one pattern per electorate, Te Pāti Māori winning all seven Māori seats, and vote totals summing.
- `packages/dashboard/src/lib/electorates.test.ts` asserts against the boundaries actually shipped in `public/boundaries/` — that 2026 has 64 general + 7 Māori electorates, that the new and renamed names are present and the abolished ones are gone, and that `MAORI_ELECTORATES` still matches every year's manifest (the seven Māori electorate names are unchanged between 2023 and 2026, which is what makes a static set safe).
- `packages/collector/src/pipeline.test.ts` runs the whole production path against the mock XML feed: the server boots, the in-process collector fetches, a snapshot lands in SQLite, `/health`, `/ready` and `/api/history/*` reflect it, and a Socket.io client receives the payload.
- No special setup or services required; tests are self-contained.

## Gotchas

- **Running a new election cycle means bumping `ELECTION_YEAR`.** The default is still `2023`; 2026 is `ELECTION_YEAR=2026`. The boundary year follows the results automatically. The dev seed (`packages/dashboard/server/seed.ts`) still hardcodes the 2023 electorate list; the mock server does not — use `npm run start:mock -- --year 2026` for a full 2026 dry run.
- **The 2026 XML feed is not published yet.** `https://electionresults.govt.nz/electionresults_2026/xml/` 404s until results start flowing, and the live election-night feed is arranged through the Electoral Commission's media team. The 2023 archive still serves for development.
- `@election-night/core` must be built before running the collector or dashboard. If you see module-resolution errors, run `npm run build:core`.
- `better-sqlite3` is a native Node dependency. If installation fails, the environment likely needs build tools (Python, a C++ compiler).
- The collector creates `.data/` automatically for the SQLite DB and the feed-event cache. In the Fly deployment these paths point at the `/data` volume.
- The dashboard server serves the built Vite bundle from `DIST_DIR` in production. For local dev, `npm run dev` starts both the server and the Vite dev server.
- Mock server (`serve-mock.ts`) serves mock XML that matches the Electoral Commission feed schema, so the collector and the prediction pipeline run exactly as they do against the real feed.

## Deployment

- Production is a **single Fly.io app** (`fly.toml` + `Dockerfile.app`) running **one Node process**: the dashboard server (public, `:3456`) with the collector loop inside it. The image runs `packages/dashboard/server/index.ts` through `tsx` rather than bundling — bundling would break `better-sqlite3` (native) and drizzle's on-disk migrations. SQLite and the feed-event cache live on the `/data` volume.
- The collector polls a cached static XML asset reachable from datacenter egress, so it no longer needs a residential connection or proxy, and no longer needs its own host or process.
- PR previews use `fly.preview.toml` (no volume, `COLLECTOR_ENABLED=false`) so they never poll the live feed.
- CI: `.github/workflows/deploy.yml` deploys `main` to Fly, gated on `checks.yml` (lint/typecheck/test) and `security.yml`; `preview.yml` deploys per-PR preview apps.
