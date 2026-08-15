# Code Simplicity & Structure Review — Recommendations

_Review date: 2026-02. **Worked through: 2026-08-15 — items 1–7 complete except the optional seed-generation follow-up in #4.** Scope: `packages/core`, `packages/collector`, `packages/dashboard` (server + frontend)._

**Overall verdict:** well-structured codebase. Package boundaries are clean (core is genuinely shared, the DB lives only in the collector, the dashboard server never opens SQLite), modules are small and single-purpose, tests sit next to what they test, and AGENTS.md is accurate. The items below are ranked by impact; nothing is urgent-rewrite territory.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## 1. Dashboard `server/` directory is never typechecked — 🔴 high value, low effort

`packages/dashboard/tsconfig.json` only includes `src`; `tsconfig.node.json` only includes `vite.config.ts`. So `server/index.ts`, `history-upstream.ts`, `metrics.ts`, `server/config.ts`, and `seed.ts` are invisible to `npm run typecheck`.

Proof it's biting already: `server/index.ts:514` references `MetricEvent` **without importing it** — a compile error if checked, yet CI is green.

- [x] Add `packages/dashboard/tsconfig.server.json` covering `server/**` (node-ish settings: `types: ["node"]`, `moduleResolution: bundler`, `strict`).
- [x] Wire it into the root `typecheck` script (e.g. `tsc -b packages/dashboard/tsconfig.server.json` or project references).
- [x] Fix the errors it surfaces (at minimum the missing `MetricEvent` import). All 9 surfaced errors fixed.
- [x] Confirm `npm run build` for the dashboard doesn't regress (server still runs via `tsx`; typecheck-only is fine).

## 2. Duplicated diff/event logic between collector and dashboard server — 🔴 real behavioral drift

- `computeDiff()` exists twice: `packages/collector/src/results.ts` and `packages/dashboard/server/index.ts`.
  Diverged subtly: collector sets `previousLeaderName` unconditionally; server gates it on `leaderChanged`; server defaults `currentMarginPercent` to `0`, collector doesn't.
- `determineEvents()` (collector) and `determineFeedType()` (server) re-implement the same leader-change / count-completed / prediction-called classification.
- `templateSummary()` and `templateCommentary()` in `server/index.ts` are two ~60-line, ~90%-identical text builders.

Two implementations of "what changed between scrape cycles" risks inconsistent webhooks vs. feed stories on election night.

- [x] Move `computeDiff` + event classification into `@election-night/core` next to the `ElectorateDiff` type (core already owns the type).
- [x] Point both the collector (`results.ts`) and the dashboard server at the shared implementation; delete the local copies.
- [x] Reconcile the drifted fields deliberately (decide: gate `previousLeaderName` on `leaderChanged`? default `currentMarginPercent`?) and add/adjust tests to lock it in.
- [x] Merge `templateSummary`/`templateCommentary` into one function with a short/long variant parameter.

## 3. `dashboard/server/index.ts` is a 548-line monolith — 🟠

One file owns: static file serving (hand-rolled MIME map + SPA fallback), `/health`, `/ready`, `/metrics`, `/api/history/*` routing, feed-event generation/copywriting, and all Socket.io wiring. It also uses `console.log` throughout while the collector has a proper `tslog` logger.

- [x] Split into `server/static.ts` (MIME map, SPA fallback), `server/api.ts` (history routes), `server/feed.ts` (diff → events → copy), leaving a slim `index.ts` for HTTP + Socket.io wiring.
- [x] Replace `console.log/error` in the server with a logger (reuse the collector's `tslog` setup, or a minimal shared one in core).
- [x] Fix the path-traversal prefix bug while in there: `resolvedPath.startsWith(DIST_DIR)` should be `startsWith(DIST_DIR + path.sep)` (a sibling dir like `dist-evil` currently passes; URL normalization makes it hard to exploit but it's a one-line fix).

## 4. ~10,000 lines of committed data masquerading as source — 🟠

`packages/collector/src/electorate-votes-data.ts` (9,204 lines) + `html-fixture.ts` (846 lines) is ~40% of the codebase by line count. It's static fixture data.

- [x] Move both to `packages/collector/src/fixtures/*.json`; keep `fixtures.ts` as the typed accessor (import JSON with `resolveJsonModule`, or read via `fs` in tsx land).
- [x] Verify `reducers.test.ts` and anything else importing `fixtures` still passes unchanged.
- [x] (Won't-do) replace committed blobs with `seed.ts`-style generation — decided against: the JSON files are exact 2023 real-world fixtures, which makes regression tests meaningful; generation logic would itself need testing; and it's dev/test-only data with zero runtime impact.

## 5. Two parallel config systems for the collector — 🟠

The collector reads from both core's hand-rolled `config` (`webhookUrl`, `cachePaths`, `predictionConfidence` — see `results.ts`) and its own zod-validated `collectorConfig` (including its **own** `webhookUrl`). Which one wins depends on which file you're in. Core's config also exports scraping concerns (`BASE_RESULTS_URL`, CSS selectors) that belong to the source adapter.

- [x] Move `BASE_RESULTS_URL` + selector constants into `NzElectionResultsSource` (or its defaults) in core's `sources/`.
- [x] Route all collector runtime config through `collectorConfig` only; delete the duplicated `webhookUrl`/cache-path lookups from core config usage in the collector.
- [x] Core config keeps only genuinely cross-package values (`predictionConfidence`); update AGENTS.md env-var docs to match.

## 6. Frontend redundancies — 🟡

- `useElectorateHistory`, `usePartyVoteHistory`, `useSnapshotMetas` in `src/hooks/useVoteHistory.ts` are three hand-rolled copies of the same fetch/loading/error state machine.
- `src/lib/history-types.ts` and `server/history-upstream.ts` define the same response shapes independently — producer/consumer contract can drift silently.

- [x] Collapse the three hooks into one generic `useApi<T>(url)` (plus thin wrappers if the call sites want named hooks).
- [x] Move the history response types into `@election-night/core` (or a single shared file) and have both server and frontend import them.

## 7. Nits — 🟢

- [x] `scrape-cycle.ts` shadows its `source: ElectionSource` parameter with `for (const source of electorateSources)` in the metrics loop — rename the loop variable. Consider re-enabling `@typescript-eslint/no-shadow` (currently globally disabled).
- [x] `predictWinner` in `core/reducers.ts` builds its result via an `as` cast; return a fresh object literal like `calculateLead` does.
- [x] `sleep()` lives in `scraper.ts` but is generic — move to a shared util.
- [x] `core/src/global.d.ts` and `collector/src/global.d.ts` duplicate the same two `declare module` lines — left as-is (both packages need the ambient declarations in their own program; no `@types/*` packages exist for `jstat`/`sainte-lague`) the same two `declare module` lines; prefer proper `@types/jstat` / typed deps or a single shared ambient file.
- [x] `POST /api/clear` is unauthenticated and resets live state for all clients; add a simple shared-secret header check.

---

## Suggested order of attack

1. **#1** typecheck `dashboard/server` (~20 lines of tsconfig; catches latent bugs immediately).
2. **#2** dedupe diff/event classification into core (removes real behavioral drift).
3. **#3** split `server/index.ts` into modules (fold in the traversal fix + template merge).
4. **#4** move fixture blobs to JSON.
5. **#5** config consolidation, **#6** frontend hook/type dedup, **#7** nits as time allows.
