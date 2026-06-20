# Election Night — Architecture, Code Quality & Testing Recommendations

> Critical assessment as of 2026-06-20.
> Tool-chain health: `npm run lint` → clean, `npm run typecheck` → passes, `npm test` → 190/190 pass.
>
> **Implemented in this run:** A1, A2, A3 (see Architecture section for details).

---

## Executive Summary

The project is a well-scoped, working real-time election tracker with sensible package boundaries, a passing test suite, and pragmatic operational features (mock server, SQLite persistence, Prometheus metrics, Fly.io/Docker deployment). Most of the high-value refactor work has already landed: `@election-night/core` ships compiled JS, configuration is validated with Zod, the dashboard uses a single shared Socket.io provider, in-place mutations have been removed, feed events persist across restarts, and an end-to-end pipeline test exercises the real data flow.

The remaining risks are **testability, operational packaging, and surface-area coverage** rather than fundamental design flaws. The remaining gaps are: the dashboard server is a 500-line monolith with almost no automated tests, and several important frontend pages/hooks are untested.

---

## Architecture & Design

### Strengths

- Clean `core` / `collector` / `dashboard` split with explicit package boundaries.
- Swappable `ElectionSource` adapter via `ELECTION_SOURCE_PATH`.
- Pragmatic persistence: SQLite snapshots + JSON cache + Socket.io broadcast.
- Built-in mock server and synthetic electorates for local development and integration tests.
- Dashboard server exposes history APIs and Prometheus `/metrics`.

### Recommendations

| # | Priority | Recommendation | Rationale |
|---|----------|----------------|-----------|
| A1 | **High** | ✅ Implemented — Move the remaining top-level side effects out of `packages/collector/src/index.ts` into an explicit `main()` function. | `openDb()`, `connectWs()`, and `loopRun()` now run only when `main()` is invoked, so importing the module no longer starts the scraper. The file auto-calls `main()` only when it is the entrypoint. |
| A2 | **High** | ✅ Implemented — Stop `packages/core/src/config.ts` and `NzElectionResultsSource` from reading `process.env` directly; pass configuration into the source adapter. | `core` now exposes pure defaults. Selector/base-URL configuration lives in the validated `collectorConfig` and is passed into `NzElectionResultsSource`. `results.ts` now reads `cachePath` and `webhookUrl` from `collectorConfig` instead of `@election-night/core/config`. |
| A3 | **High** | ✅ Implemented — Make the custom source loader in `packages/collector/src/source-loader.ts` fail fast when `ELECTION_SOURCE_PATH` is set but cannot be loaded. | The loader now re-throws a descriptive error instead of silently falling back to the default NZ source. |
| A4 | **Medium** | ✅ Implemented — Decompose `packages/dashboard/server/index.ts` into focused modules (HTTP router, Socket.io handlers, feed engine, static file handler). | Split into `feed-engine.ts`, `http-router.ts`, `socket-handlers.ts`, and a thin `index.ts` orchestrator. Behavior is preserved; the server is now ~180 lines. |
| A5 | **Medium** | ✅ Implemented — Add pagination / upper bounds to `/api/history/*` endpoints. | All history endpoints now accept `limit` and `offset` query params, default to 100 rows, and cap `limit` at 1000. `db-reader.ts` applies `LIMIT`/`OFFSET` in SQL. |
| A6 | **Medium** | ✅ Implemented — Bundle the collector into the production Docker image instead of running `npx tsx` at runtime, and prune `devDependencies`. | The Dockerfile now bundles the collector to `/app/packages/collector/dist/index.mjs` with esbuild, `entrypoint.sh` runs the bundle, and the final stage runs `npm prune --omit=dev --ignore-scripts`. |
| A7 | **Low** | Consider unifying the diff/event-generation logic used for webhooks (collector) and feed events (dashboard server). | Two similar but separate `computeDiff`/`determineEvents` implementations risk diverging semantics. |
| A8 | **Low** | Restrict Socket.io CORS `origin` in production or document that admin-style endpoints (`/api/clear`) are intentionally public. | Current `origin: '*'` is acceptable for a public dashboard but worth reviewing if authenticated endpoints are added. |

---

## Code Quality

### Strengths

- Strict TypeScript enabled; root and dashboard type-checks both pass.
- ESLint is clean (no warnings) and Prettier formatting is consistent.
- Domain types are explicit and additive in `@election-night/core/types.ts`.
- Reducers no longer mutate inputs in place.
- Webhook POSTs and socket publishes have retry/backoff.

### Recommendations

| # | Priority | Recommendation | Rationale |
|---|----------|----------------|-----------|
| Q1 | **High** | ✅ Implemented — Add defensive diagnostics to `NzElectionResultsSource` when expected selectors match nothing. | `parseRawResults` now validates parsed counts against selector matches and throws a descriptive error (including selector match counts and an HTML preview) when candidate/party votes are empty or vote counts are zero because selectors did not match. |
| Q2 | **Medium** | ✅ Implemented — Replace `console.log`/`console.error` in the dashboard server with the structured logger used in the collector, or a common logging abstraction. | Added `packages/dashboard/server/logger.ts` (tslog), a `logLevel` config option, and replaced console calls in `server/index.ts` and `server/db-reader.ts` with `log.info`/`log.warn`/`log.error`. |
| Q3 | **Medium** | Optimize `ElectorateMap`: derive a stable leading-party map once per render and avoid the giant string key recomputation. | Currently it re-sorts party votes and rebuilds a massive `key` prop for every feature on every update. |
| Q4 | **Medium** | Replace the global mutation of `L.Icon.Default.prototype` in `ElectorateMap.tsx` with a non-mutating icon configuration. | It is a surprising side effect at module load and relies on Leaflet internals. |
| Q5 | **Low** | Tighten `TYPE_CONFIG` typing in `packages/dashboard/src/pages/Feed.tsx` to use the `FeedEventType` union exhaustively. | The `Record<string, ...>` typing weakens the guarantee that every event type has config. |
| Q6 | **Low** | Remove redundant `as (PartyList & WithAdjustedRank)[]` casts in `Seats.tsx` if the incoming type is already correct. | Casts reduce confidence and can hide future type drift. |
| Q7 | **Low** | Move `source-loader.ts`’s direct `process.env.LOG_LEVEL` read into the validated collector config. | Minor inconsistency with the rest of the config schema. (Note: `source-loader.ts` now uses `collectorConfig.logLevel`.) |

---

## Testing Strategy

### Strengths

- Vitest runs from root; 190 tests pass.
- Core reducers, DB writes, webhook/diff logic, scraper parsing, synthetic scenarios, and a full pipeline integration test are covered.
- Frontend has a reusable `MockSocketProvider` and tests for the two main hooks plus `Seats` and `Feed` pages.
- The pipeline integration test spins up the mock server, dashboard server, collector, and a real Socket.io client.

### Recommendations

| # | Priority | Recommendation | Rationale |
|---|----------|----------------|-----------|
| T1 | **High** | Add unit tests for `packages/dashboard/server/index.ts`: feed event generation, `/api/clear`, `/api/history/*`, static/SPA fallback, and socket broadcast behavior. | The server is a large, critical surface area with almost no automated coverage. |
| T2 | **High** | Add tests for `packages/dashboard/server/db-reader.ts` against a seeded temp SQLite database. | History API logic is currently untested. |
| T3 | **High** | Add config validation tests that assert clear startup failures for invalid/missing env vars in both collector and dashboard server. | Prevents silent misconfiguration in production. |
| T4 | **High** | Expand frontend component tests to cover `ParliamentSeats`, `Electorates`, `CloseCalls`, `Parties`, `Trends`, and the history hooks. | Only `Seats` and `Feed` pages are currently exercised. |
| T5 | **Medium** | Test `SocketProvider` connection lifecycle (reconnect, `feed_history`, `clear`, cleanup) using a mocked `socket.io-client`. | The provider is the central data layer for the UI; its behavior is only indirectly tested. |
| T6 | **Medium** | Add tests for scraper/source error paths: empty HTML, changed selectors, network failure, and partial electorate failures. | Current scraper tests only cover the happy path. |
| T7 | **Medium** | Add tests for `packages/collector/src/retry.ts` and the webhook retry path. | Retry is critical for election-night reliability but only covered implicitly. |
| T8 | **Low** | Add an integration test for collector restart/reconnection and feed event persistence. | Validates operational resilience if the collector or server restarts. |
| T9 | **Low** | Add load/reliability tests for burst updates and temporary socket server outages. | Simulates election-night traffic patterns. |

---

## Operations & Deployment

| # | Priority | Recommendation | Rationale |
|---|----------|----------------|-----------|
| O1 | **Medium** | Bundle the collector and dashboard server for production, and run `npm prune --omit=dev` before the final Docker stage. | The current image runs the collector with `npx tsx` and ships all dev dependencies. |
| O2 | **Medium** | Add a DB retention policy or scheduled vacuum for scrape snapshots. | Every poll writes a full snapshot; without cleanup the DB will grow continuously. |
| O3 | **Medium** | Add alerting rules on Prometheus metrics: collector disconnected, high scrape error rate, no updates for N minutes. | Election night requires fast detection of scraper or network failures. |
| O4 | **Low** | Authenticate or network-restrict admin endpoints such as `POST /api/clear`. | Currently any connected client can reset feed state. |

---

## Suggested Implementation Order

1. **T1 / T2 / T3** — Backfill dashboard server and config tests.
4. **T4 / T5** — Expand frontend test coverage.
5. **Q1 / Q3 / Q4** — Harden scraper diagnostics and optimize frontend hot paths.
6. **O1 / O2 / O3** — Production packaging and retention improvements.
7. **A6–A8, Q2, Q5–Q7, T6–T9, O4** — Polish and deeper reliability work.

---

## Notes for Reviewers

- The dashboard is intentionally **not** included in root `tsconfig.json` project references; it is type-checked separately via `tsc -b packages/dashboard` in the `typecheck` script. This is acceptable but should be preserved in CI.
- `fly.toml` correctly uses `/health` (not `/ready`) for Fly’s `http_service` checks because `/ready` returns 503 until the collector has written its first snapshot. Keep `/ready` for manual or orchestrator-level readiness probes.
- `better-sqlite3` and Puppeteer/Chromium are heavy native dependencies; any CI or contributor setup must account for build tools and long installs.
- The dashboard server's config validation (`server/config.ts`) intentionally still uses `console.error` for invalid config because the logger depends on the validated config object.
