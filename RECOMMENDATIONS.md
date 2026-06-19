# Election Night — Architecture, Code Quality & Testing Recommendations

> Generated from a critical assessment of the repository.
> Current tool-chain health: `npm run lint` → 0 warnings, `npm run typecheck` → passes, `npm test` → 182/182 pass.

---

## Executive Summary

The project is a well-scoped, working real-time election tracker with sensible package boundaries and a passing test suite. The main risks are operational/testability issues rather than design flaws. Several of the highest-priority items have already been implemented: the collector entrypoint is now side-effect free, configuration is centralized and validated with Zod, the dashboard is included in the root type-check, the frontend uses a single Socket.io connection, in-place mutations have been removed, feed events persist across restarts, an end-to-end pipeline integration test exercises the full flow, and frontend component tests now cover the main hooks and pages.

---

## Architecture & Design

### Strengths
- Clean `core` / `collector` / `dashboard` split.
- Swappable `ElectionSource` adapter (`ELECTION_SOURCE_PATH`).
- Pragmatic persistence: SQLite snapshots + JSON cache + Socket.io broadcast.
- Built-in mock server and synthetic electorates for local testing.

### Recommendations

| # | Priority | Status | Recommendation | Rationale |
|---|----------|--------|----------------|-----------|
| 1 | **High** | ✅ Implemented | Refactor collector entrypoint (`packages/collector/src/index.ts`) so that module load is side-effect free and a pure `scrapeCycle(source, configs)` function does the work. | The previous file read CSVs, opened the DB, connected WS, and started the loop at import time, making unit/integration testing nearly impossible. |
| 2 | **High** | ✅ Implemented | Centralize and validate configuration using a schema (e.g., Zod) in each package. | `process.env.*` was scattered across files; invalid/missing values caused late or silent failures. |
| 3 | **High** | ✅ Implemented | Include `packages/dashboard` in the root type-check (`tsconfig.json` project references) or run its `tsc -b` in CI. | Previously only `core` and `collector` were checked at root; dashboard type drift was possible. |
| 4 | **Medium** | ✅ Implemented | Add a build step for `@election-night/core` and ship compiled JS. | Core is consumed as raw `.ts`; production bundling and external consumers are fragile. |
| 5 | **Medium** | ✅ Implemented | Persist feed events to SQLite/JSON so dashboard server restarts do not lose history. | Feed events previously lived only in memory on the server. |
| 6 | **Medium** | ✅ Implemented | Add retry/backoff for webhooks and socket publishes; consider persisting outbound events until acknowledged. | Current code is fire-and-forget; flaky networks will lose updates. |

---

## Code Quality

### Strengths
- Strict TypeScript enabled; project type-checks cleanly.
- ESLint is now clean (0 warnings).
- Consistent Prettier formatting.
- Domain types are explicit and additive.

### Recommendations

| # | Priority | Status | Recommendation | Rationale |
|---|----------|--------|----------------|-----------|
| 8 | **High** | ✅ Implemented | Eliminate in-place mutations in reducers and React components. | `calculateLead` sorted `candidateVotes` in place; `Seats.tsx` mutated `partyVote` array from state. |
| 9 | **High** | ✅ Implemented | Create a single Socket.io provider/context in the dashboard so `useResults` and `useFeed` share one connection. | Previously two sockets were opened per client. |
| 10 | **Medium** | ✅ Implemented | Replace `any` in dashboard with proper types (`geoData`, Leaflet, etc.) and remove the unused `eslint-disable` in `ParliamentSeats.tsx`. | Improves safety and removes lint noise. |
| 11 | **Medium** | ✅ Implemented | Decompose large components (`ParliamentSeats.tsx`, `Electorates.tsx`, `CloseCalls.tsx`) into smaller files. | Readability and testability. |
| 12 | **Medium** | ✅ Implemented | Use stable, deterministic IDs for feed events instead of `Date.now()` + `Math.random()`. | Avoids collisions and improves replayability. |
| 13 | **Low** | Pending | Fix `useAnimatedNumber` stale closure by using functional `setCurrent` updates. | Prevents animation glitches under rapid updates. |
| 14 | **Low** | Pending | In `NzElectionResultsSource`, load Cheerio once per `parseRawResults` call instead of reloading for each sub-parse. | Small performance win. |
| 15 | **Low** | Pending | Remove `@types/socket.io` from dashboard dependencies. | `socket.io` v4 ships its own types. |

---

## Testing Strategy

### Strengths
- Vitest runs from root; 182 tests pass.
- Core reducers, webhook/diff logic, DB writes, scraper parsing, synthetic scenarios, a full pipeline integration test, and frontend component/hook tests are covered.

### Recommendations

| # | Priority | Status | Recommendation | Rationale |
|---|----------|--------|----------------|-----------|
| 16 | **High** | ✅ Implemented | Add an end-to-end integration test of the full pipeline: mock server → collector → dashboard server socket + DB. | No test previously exercised the real data flow. |
| 17 | **High** | ✅ Implemented | Add frontend component tests with `@testing-library/react` and a mocked Socket.io provider. | Dashboard UI is currently untested. |
| 18 | **Medium** | Pending | Add tests for `dashboard/server/db-reader.ts` against a seeded temp SQLite DB. | DB reader logic is currently untested. |
| 19 | **Medium** | Pending | Add config/validation tests that assert clear startup failures for invalid/missing env vars. | Prevents silent misconfiguration. |
| 20 | **Low** | Pending | Add load/reliability tests for burst updates and temporary socket server outages. | Election night traffic pattern. |

---

## Operations & Deployment

### Recommendations

| # | Priority | Status | Recommendation | Rationale |
|---|----------|--------|----------------|-----------|
| 21 | **Medium** | ✅ Implemented | Verify the production Docker bundle still inlines or correctly resolves the new `@election-night/core` `dist` output. | A misconfigured external or missing `prepare` build would break the image. |
| 22 | **Medium** | ✅ Implemented | Add a `/ready` health check that verifies DB readability and last scrape timestamp. | Better readiness signal than `/health`. |
| 23 | **Low** | Pending | Restrict Socket.io CORS `origin` if admin endpoints are added. | Currently `'*'`, acceptable for public dashboard but worth noting. |
| 24 | **Low** | ✅ Implemented | Add structured metrics (scrape duration, websocket client count, DB size). | Useful for election-night observability. |

---

## Suggested Implementation Order

1. ✅ Refactor collector entrypoint (#1).
2. ✅ Centralize/validate configuration (#2).
3. ✅ Include dashboard in root type-check (#3).
4. ✅ Unify frontend Socket.io provider (#9).
5. ✅ Eliminate in-place mutations (#8).
6. ✅ Add end-to-end pipeline integration test (#16).
7. ✅ Persist feed events (#5).
8. ✅ Add frontend component tests (#17).
9. ✅ Build core to JS (#4).
10. Polish remaining quality items (#6, #10–#15, #18–#24).
