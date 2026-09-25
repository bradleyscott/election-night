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
- `docs/mockups/` holds design captures of the running application (real DOM + inlined stylesheet + PNG), not hand-drawn mockups — see `docs/mockups/README.md` for how they were produced. Prefer capturing the real page over drawing one.

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
- `packages/core/src/election-results-service.ts` — `ElectionResultsService`: results for any nominated year from a pluggable connector (`createSource(year) => ElectionSource | null`). Historical cycles are fetched lazily on first request, single-flight, cached in memory for the process, and immutable; the live cycle is registered by the scrape loop (`setLiveResults`) rather than re-fetched. An unserviceable or unreachable year returns `null` — never another cycle's data — and a failed year backs off for `unavailableRetryMs` (default 5 min) with `warmPriorYears()` retrying after each scrape. See `docs/prior-election-results.md`.
- `packages/core/src/electorate-names.ts` — `normalizeElectorateName`, the single implementation of macron/case/punctuation-insensitive name matching, re-exported by the dashboard's `lib/electorates.ts` so boundary matching and prior-winner matching cannot drift.
- `packages/core/src/electorate-successions.ts` — the checked-in rename table (`ELECTORATE_RENAMES`, keyed by the later cycle, one citation per entry) plus `successionChain`/`resolvePriorElectorateName`. Long-range comparisons compose the pairwise steps. Only 1:1 name changes of a continuing electorate are listed: seats created by a merge or split are deliberately absent so they have no prior holder.
- `packages/core/src/polls-close.ts` — when polls close per cycle (7:00pm on election day; an explicit UTC offset per entry, because election day sometimes falls before the September daylight-saving switch), plus `pollsClosePhase` / `pollsCountdown` / `formatPollsCountdown` and `buildRuntimeConfig`. Only cycles the app can serve are listed; an unknown year reports `null` and the dashboard shows the plain clock rather than counting down to another election's date. The `counting` phase is election-night-only, so an archived cycle replayed later is not described as counting.
- `packages/core/src/reducers.ts` — `buildResultsPayload(results, partyListRecords)` is the whole reduction, shared by the live scrape loop and the historical service so an archived year goes through identical leaders/MoE/seat maths.
- `packages/core/src/sources/index.ts` — exports the built-in `NzElectionXmlSource`.
- `packages/core/src/sources/nz-election-xml.ts` — the only built-in source. Fetches `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml` from `https://electionresults.govt.nz/electionresults_{YEAR}/xml/` over plain HTTPS. Year from `ELECTION_YEAR`; full URL override via `XML_FEED_BASE_URL`. No browser.
- `packages/collector/src/index.ts` — main loop. Fetches the feed, calculates predictions, writes to SQLite, publishes results via a Socket.io client, and serves health/history.
- `packages/collector/src/serve-mock.ts` — mock XML feed server. Serves `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml` from evolving synthetic stages, so the full pipeline can run offline via `XML_FEED_BASE_URL`. `--year 2023|2026` (or `MOCK_ELECTION_YEAR`) picks which cycle's electorate list to replay; `packages/collector/src/synthetic-electorates.ts` holds both lists and is asserted against the dashboard boundary manifest, so a replay cannot serve an electorate the map has no polygon for.
- `packages/collector/src/clear.ts` — truncates the SQLite database and removes the JSON results cache.
- `packages/collector/src/log-webhooks.ts` — local HTTP server that pretty-prints incoming webhook payloads.
- `packages/collector/src/source-loader.ts` — loads a custom `ElectionSource` from `ELECTION_SOURCE_PATH` or falls back to `NzElectionXmlSource`.
- `packages/collector/src/historical-results.ts` — builds the collector's `ElectionResultsService`: the connector is the XML source per year, except when `XML_FEED_BASE_URL` is set (the mock replays one cycle), where only the live cycle is served and other years report unavailable.
- `packages/collector/src/health.ts` / `packages/collector/src/history-server.ts` — the collector's HTTP surface on `HEALTH_PORT`: `/health` live state and `/history/*` REST endpoints reading the collector's SQLite DB (public, unauthenticated; rate limiting is the reverse proxy's job). This is the **only** source of history data. Two of those routes are not DB queries: `/history/results/:year` and `/history/prior-winners` are answered from the in-memory results service and work before any scrape has landed.
- `packages/dashboard/server/index.ts` — Socket.io server. Receives results from the collector, broadcasts to web clients, serves the built Vite app, and exposes `/health`, `/ready`, `/metrics`, `/api/config` (the cycle it serves plus that cycle's polls-close instant, so the masthead countdown survives a new cycle without a frontend rebuild and a device clock that is wrong only affects its own visitor), `/api/clear` (optionally guarded by `CLEAR_TOKEN`), and `/api/history/*` endpoints. Split into `static.ts` (static/SPA serving), `api.ts` (history routes), and `feed.ts` (diff → feed-event generation and copy). Prometheus metrics are split by owner so no series has two sources: the dashboard server's registry (`packages/dashboard/server/metrics.ts`) owns HTTP (route-template labels from `routes.ts`), socket, feed and history-upstream series; the collector's registry (`packages/collector/src/metrics.ts`) owns cycle/fetch/webhook/DB series and serves them on its own `/metrics`. The collector still pushes `MetricEvent`s over Socket.io, but only as a heartbeat mirror — the server records `election_collector_metrics_last_received_timestamp_seconds` and does not re-register them. Fly.io scrapes exactly one metrics endpoint per process (multiple `[[metrics]]` sections only work across Fly process groups, which are separate Machines), so the server's `/metrics` merges the collector's registry over loopback (`COLLECTOR_METRICS_URL`, default `<HISTORY_UPSTREAM>/metrics`) and `fly.toml` declares that single `[metrics]` target. Machine/runtime metrics come from Fly separately. See `docs/observability.md` for the inventory, the best-practice assessment, and the dashboard and alert specs; dashboards are generated by `ops/grafana/build-dashboards.mjs`.
- `packages/core/src/diff.ts` — shared scrape-to-scrape diff and webhook/feed event classification, used by both the collector and the dashboard server. `packages/core/src/history.ts` holds the `/history/*` response types shared by collector, server, and frontend.
- `packages/dashboard/server/history-upstream.ts` — the dashboard server's history API client; fetches `/history/*` from the collector over HTTP with a short response cache. No local DB fallback exists by design. In the combined deployment this is loopback. `priorWinners()` and `resultsForYear(year)` proxy the results service; a `404` from `/history/results/:year` is a normal "this year is not available" and is not cached.
- `packages/dashboard/server/seed.ts` — generates synthetic seed data for manual testing.
- `packages/dashboard/src/main.tsx` — React frontend entrypoint (Vite, Tailwind, Leaflet, react-router-dom, Recharts).
- `packages/dashboard/src/components/Layout.tsx` — the shell; its `Dateline` strip shows the live polls-close countdown (from `usePollsClose`, which reads `GET /api/config`), the `Polls closed · counting` state on election night, and the plain date/time otherwise. `Layout.test.tsx` pins all three.
- `packages/dashboard/src/pages/Flipped.tsx` — `/flipped`: seats whose prior-cycle winner's party is not leading tonight, with the historical margin of victory beside the live lead/MoE and status, ordered by the current leader's share of the vote (not raw votes, so a big-city seat's larger margin does not outrank a smaller seat's bigger swing). Consumes `/api/history/prior-winners`, which arrives already matched to the current cycle (seats with no comparable prior holder are simply absent). Every year in the copy comes from the response's `primaryYear`, never a literal — `Flipped.test.tsx` asserts that. `packages/dashboard/src/components/PastWinners.tsx` renders the same data per electorate and deliberately makes no claim about the current count — `PastWinners.test.tsx` asserts that.
- `packages/dashboard/src/lib/prediction-status.ts` — the single mapping from prediction status to label and colour, shared by the electorate stat strip, Close Calls and Flipped.
- `packages/dashboard/public/boundaries/<year>/{general,maori}-electorates.geojson` — electorate boundary geometry, one directory per election cycle, plus a generated `index.json` manifest of electorate names per year. `packages/dashboard/src/lib/electorates.ts` holds the name normalisation and year-selection logic; `ElectorateMap.tsx` consumes both.
- `scripts/fetch-electorate-boundaries.mjs` — regenerates the boundary files from Stats NZ's public ArcGIS feature services (no API key) and rebuilds the manifest. Run it when a cycle's boundaries change.

## Architecture notes that aren't obvious from filenames

- **Core is built.** `packages/core` ships compiled JS from `dist/`. Root scripts run `npm run build:core` before starting the collector or dashboard. `npm install` triggers `prepare` which also builds core.
- **Socket.io is the backbone.** The collector is a Socket.io _client_; the dashboard package runs the _server_. The server listens on `WS_PORT` (default `3456`). Dashboard `index.html` hardcodes a `preconnect` to `http://localhost:3456`.
- **The results source is the official XML feed.** `NzElectionXmlSource` reads `candidates.xml`, `parties.xml`, `electorates.xml`, and per-electorate `e{NN}/e{NN}.xml`. The feed supplies candidate names, party mapping, and party list rankings directly, so there are no static CSV data files and no HTML parsing. The feed is a Cloudflare-cached static asset that is reachable from datacenter egress, so the collector needs no proxy or residential connection. See the election-night caveats in `README.md`.
- **The live feed encodes apostrophes numerically.** 2023's `candidates.xml` writes `O&#39;CONNOR` where the 2017 and 2020 archives write `O&apos;CONNOR`, and both are valid XML. The parser sets `htmlEntities: true` so either form decodes to an apostrophe; without it the numeric reference survives parsing and the name reaches the tables, map labels and chart legends literally as `O&#39;CONNOR, Damien` — visibly wrong in the live cycle while the archives looked fine. `nz-election-xml.test.ts` covers both forms.
- **No browser anywhere.** `cloakbrowser`, `playwright-core`, `cheerio`, and the HTML scraping path were removed. Do not reintroduce a browser into the collector without a matching plan update.
- **`calculateLead(results)` resolves party from each candidate.** There is no separate name→party map. Custom sources must populate `party` on `RawElectorateResults.candidateVotes`.
- **Dashboard is NOT part of root `tsc -b` references.** Root `tsconfig.json` only references `core` and `collector`. `dashboard` typechecks via its own `tsc -b` inside `npm run build` and in `npm run typecheck`.
- **SQLite + Drizzle ORM.** Collector uses `better-sqlite3` (native dependency). The DB path defaults to `./.data/election_results.db`. Migrations live in `packages/collector/drizzle/` and auto-run on startup via `migrate()` in `db.ts`. Drizzle config is at `packages/collector/drizzle.config.ts`.
- **The database is bounded by `RETENTION_HOURS` (default 24), continually.** `packages/collector/src/retention.ts` decides when to sweep (`RETENTION_SWEEP_MS`, 15 min) and how much to keep; `pruneSnapshots()` in `db.ts` deletes snapshots older than the window, oldest first, in batches of 100 with a WAL checkpoint between them (on a nearly-full volume one large `DELETE` fails with `SQLITE_FULL` and frees nothing). The sweep runs between cycles for the life of the process — the startup prune alone would fire once per deploy, and production runs for weeks. `compactDatabase()` (incremental auto-vacuum, enabled in `openDb`) returns freed pages to the filesystem, so the file shrinks instead of keeping its high-water mark forever. The newest snapshot is always kept; `RETENTION_HOURS=0` disables pruning and nothing else bounds the DB. Below 5% free space the window collapses to `PRESSURE_KEEP_HOURS` (1h): a database that cannot be written serves nothing. A full volume is not a loud failure: every write fails with `SQLITE_FULL` while the collector keeps fetching happily, so pages go empty and nothing looks broken. `election_disk_size_bytes` / `election_disk_available_bytes` (`recordDiskUsage()`, sampled per cycle) plus the `status="error"` write counter are the signals; see `docs/observability.md` §6.
- **The dashboard server never opens a database.** The collector owns SQLite; the server fetches history from the collector's `/history/*` REST API (`HISTORY_UPSTREAM`, default loopback) and relies on Socket.io for live results.
- **Electorate boundaries are keyed by election year and matched by name.** Boundaries are redrawn most cycles: 2026 has 64 general electorates (down from 65) with 10 renamed or new and 11 gone. `selectBoundaryYear()` scores each year's manifest names against the electorates being rendered and uses the best match, so running against 2023 data still draws 2023 boundaries; `VITE_ELECTION_YEAR` pins the choice. Names are compared with macrons, case and punctuation stripped (`normalizeElectorateName`), because the Commission's feed and Stats NZ both publish macronised and ASCII variants. When results and polygons cannot be reconciled the map shows a "Boundary mismatch" banner naming them — never silently draw the wrong cycle. See `docs/2026-election-boundaries.md`.
- **History is scoped to one election cycle.** `scrape_snapshots.election_year` stores `ELECTION_YEAR` per snapshot and `/history/*` filters to the active year (with a `?year=` override), because the Fly deployment keeps SQLite on a persistent volume across cycles. The JSON diff cache is tagged with its cycle too: a cache from another cycle is ignored rather than diffed against, or the first scrape of a new cycle would emit bogus feed events. In the combined image `RESULTS_CACHE_PATH` and `CACHE_PATH` are the _same_ file — the collector writes the diff baseline and the dashboard server preloads it so the first page load is not blank — so `packages/dashboard/server/results-cache.ts` reads the tagged shape and refuses a cache from another cycle instead of assigning it to `electorateResults`.
- **Environment loading.** Collector and dashboard server entrypoints import `dotenv/config`. Expected variables:
  - Source: `ELECTION_YEAR` (default `2023`; builds the XML feed URL), `XML_FEED_BASE_URL` (optional full override, must end with `/`; used to point at the mock server), `PRIOR_ELECTION_YEAR` (optional; cycle the Flipped page compares against — unset uses the newest prior cycle the archive resolves)
  - Webhooks: `WEBHOOK_URL` (single URL; payload includes an `event` field to discriminate type), `WEBHOOK_LOG_PORT` (default `3458`)
  - Runtime: `POLL_INTERVAL_MS` (default 120s), `CONCURRENCY` (default 10), `FETCH_TIMEOUT_MS` (default 30s), `FETCH_PACING_MS` (default 300; jittered delay between electorate fetches), `HEALTH_PORT` (default 3459; collector health/live-state endpoint + unauthenticated `/history/*` REST API — rate limit at the proxy when publicly exposed), `LOG_LEVEL` (0=silly, 1=trace, 2=debug, 3=info), `WS_PORT`/`WS_URL`, `WS_RECONNECT_DELAY_MS` (default 2s), `DB_PATH` (default `.data/election_results.db`), `RESULTS_CACHE_PATH` (default `.data/electorate_results.json`; JSON cache of the current cycle's electorate results used as the webhook diff baseline — tagged with `ELECTION_YEAR`, and a cache from another cycle is ignored rather than diffed against), `ELECTION_SOURCE_PATH`, `COLLECTOR_ENABLED` (combined image: set `false` to run the dashboard server alone)
  - Mock: `MOCK_PORT` (default `3457`), `MOCK_ELECTION_YEAR` (default `2023`; the cycle the mock replays — `2026` uses the 64 + 7 2025 boundaries; `--year` overrides it)
  - Web server: `DIST_DIR` (default `./dist`), `CACHE_PATH` (default `.data/electorate_results.json`), `FEED_CACHE_PATH` (default `.data/feed_events.json`), `MAX_FEED_EVENTS` (default `200`), `CLEAR_TOKEN` (optional; when set, `POST /api/clear` requires it in the `x-clear-token` header), `HISTORY_UPSTREAM` (dashboard server: base URL of the collector's history REST API — always used, defaults to `http://127.0.0.1:3459` for a co-located collector), `COLLECTOR_METRICS_URL` (dashboard server: collector `/metrics` merged into the single scraped endpoint; defaults to `<HISTORY_UPSTREAM>/metrics`, empty disables it)
  - Frontend: `VITE_WS_URL` (Socket.io URL override), `VITE_ELECTION_YEAR` (pin the electorate boundary dataset to an election year; unset = pick the year whose electorate names match the live results)
  - Observability: `APP_VERSION` / `GIT_SHA` (optional; exposed as `election_build_info` on both processes)
- **Custom source adapters.** Set `ELECTION_SOURCE_PATH` to a JS/TS module exporting a class implementing `ElectionSource` (or `NzElectionXmlSource`). The module must set `party` on candidate votes.

## Toolchain and style quirks

- ESLint ignores `**/components/ui/**`, `**/dist/**`, `**/node_modules/**`, `**/.cache/**`, and `**/.data/**`.
- Prettier config: `singleQuote: true`, `trailingComma: es5`.
- ESLint disables `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-empty-function`, `@typescript-eslint/no-shadow`, and `no-console` globally. Unused vars are warned on except function arguments.
- Tailwind dark mode is `class` based. Light is the default: an inline script in `index.html` adds the `dark` class only when localStorage holds `election-night:theme = dark`, and `ThemeToggle` keeps it in sync. The OS preference is deliberately not followed.

## Testing

- Vitest runs `packages/*/src/**/*.test.{ts,tsx}` from the root.
- `packages/dashboard/src/test/setup.ts` stubs `ResizeObserver` and `window.matchMedia` for component tests.
- `packages/collector/src/synthetic-electorates.test.ts` asserts the mock's electorate lists match the boundary manifest the dashboard map draws from — for every supported cycle — plus the general/Māori split, one pattern per electorate, Te Pāti Māori winning all seven Māori seats, and vote totals summing.
- `packages/core/src/electorate-successions.test.ts` covers rename resolution (including composition across cycles and spelling-only changes) and asserts every entry maps one name to a different name exactly once. `packages/dashboard/src/lib/electorates.test.ts` checks the table against the shipped boundary manifests: destinations exist in their cycle, the old names are gone, and 2026 renames start from names 2023 actually had.
- `packages/core/src/election-results-service.test.ts` covers caching, single-flight, retry backoff, the stop-at-the-first-gap walk, rename matching, and that an unserviceable year reports `null` rather than another cycle's results.
- `packages/dashboard/src/lib/electorates.test.ts` asserts against the boundaries actually shipped in `public/boundaries/` — that 2026 has 64 general + 7 Māori electorates, that the new and renamed names are present and the abolished ones are gone, and that `MAORI_ELECTORATES` still matches every year's manifest (the seven Māori electorate names are unchanged between 2023 and 2026, which is what makes a static set safe).
- `packages/collector/src/pipeline.test.ts` runs the full collector → Socket.io → dashboard → SQLite path against the mock XML server.
- No special setup or services required; tests are self-contained.

## Gotchas

- **The masthead countdown only runs for the cycle being served.** It counts down to that cycle's polls close (`packages/core/src/polls-close.ts`, 7:00pm on polling day): before the close it counts down, on the night it reads `Polls closed · counting`, and any other time — an archived cycle, or no cycle at all — the dateline falls back to the plain date and time rather than implying a count is live. So a local run on the default `ELECTION_YEAR=2023` shows the clock; use `ELECTION_YEAR=2026` to watch the countdown, and set the system clock (or stub `/api/config`) to review the final hour and counting states.
- **Running a new election cycle means bumping `ELECTION_YEAR`.** The default is still `2023`; 2026 is `ELECTION_YEAR=2026`. The boundary year follows the results automatically. The dev seed (`packages/dashboard/server/seed.ts`) still hardcodes the 2023 electorate list; the mock server does not — use `npm run start:mock -- --year 2026` for a full 2026 dry run.
- **Prior-election results need the real archive.** The mock feed replays one cycle, so with `XML_FEED_BASE_URL` set the collector reports prior results unavailable (by design — the alternative is labelling tonight's mock candidates as last election's winners) and `/flipped` shows its unavailable state. For a dev run with prior winners, point the collector at the real archive (`ELECTION_YEAR=2023 npm run start:collector`, prior cycles 2020 and 2017). Only 2020, 2017 and 2023 archives exist; 2014 and earlier 404, which is what bounds "as far back as XML" and why failures back off for 5 minutes.
- **The 2026 XML feed is not published yet.** `https://electionresults.govt.nz/electionresults_2026/xml/` 404s until results start flowing, and the live election-night feed is arranged through the Electoral Commission's media team. The 2023 archive still serves for development.
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
