# Implementation hand-off: election-night reliability and simplification

**Start here.** This is the authoritative execution plan for the next coding agent.
The [architecture review](architecture-review-2026-11-08.md) explains R1–R9;
the [operational review](election-night-2026-11-07-review.md) contains incident evidence.
Their section numbers are finding IDs, **not a competing implementation order**.

**Scope:** implement the tasks below in order, as separate reviewable changes.
Do not rewrite the stack, deploy to Fly, change production resources/cadence,
reset a volume, or publish revised probabilities without explicit approval.
This document authorises no production action. Preserve unrelated working changes.

## 1. First actions for the implementing agent

1. Read `AGENTS.md`, this plan, then the relevant finding/evidence sections.
2. Run `git status --short` and record the starting SHA. Several unrelated
   waiting-state, count-band, Trends and Flipped edits were present during review.
   Do not stage, discard or incorporate them accidentally. Use a clean worktree
   from the agreed branch if necessary; do not carry those edits into it.
3. Check whether each task has already landed since this hand-off. Match tests
   and behaviour, not just commit messages. Update task status with PR/SHA evidence.
4. Run `npm run build:core`, then the task's focused tests before modifying code.
   If the baseline fails, record that separately rather than silently fixing
   unrelated failures. Use `npx vitest run`, not the root watch-mode `npm test`.
5. **Begin with task 01.** Add a failing regression before changing the implementation.
   You do not need to repeat the whole architecture review or access production
   sessions/logs to begin; the required cases are specified below.

### Already present at review: preserve, do not reimplement

| Existing change                                                                | Reference                | Remaining work                                                                   |
| ------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| Fatal collector HTTP listener `error`                                          | PR #132 / `4d038b9`      | Does not catch a listening-but-unresponsive HTTP service                         |
| History refetch on socket `resultsUpdatedAt`                                   | PR #132 / `4d038b9`      | No independent polling/focus/error recovery or cache/revision coordination       |
| Metrics merge timeout/fallback                                                 | PR #133 / `d29ab09`      | Does not make history current or prove collector HTTP responsiveness             |
| Dashboard-side collector watchdog                                              | PR #134 / `94c2be8`      | Keep it; restart is containment, not proof of root-cause resolution              |
| All-places-reported overrides remaining-vote forecast; updated cycle constants | `989c40b`                | Denominator, unknown-data, phase and calibration issues remain                   |
| Quiet-period daily polling                                                     | `fly.toml`, release v112 | Do not silently restore live cadence or interpret planned quietness as an outage |

Loading-state/UI work may also be uncommitted. Inspect it; a prior agent saying
“fixed” does not establish that a change is merged or deployed.

## 2. Execution order and completion ledger

All items start **not implemented by this review**. Check a box only with linked
PR/SHA, tests and the stated acceptance evidence. “P0” means required before another
trusted live run; the parser repair is also a gate on further calibration claims.

| Done | Task / suggested PR title                                            | Priority                     | Findings | Prerequisites                                |
| ---- | -------------------------------------------------------------------- | ---------------------------- | -------- | -------------------------------------------- |
| [x]  | **01 — Expose stale history and fix dependency verification**        | P0                           | R3       | None                                         |
| [ ]  | **02a — Bound history queries and global voting-place load**         | P0                           | R6       | 01; capture baseline first                   |
| [ ]  | **02b — Move database execution off the collector HTTP loop**        | P0                           | R6       | 02a                                          |
| [ ]  | **03 — Adopt query-managed history refresh and recovery**            | P0                           | R2       | 01, 02a; rebase after 02b                    |
| [ ]  | **04 — Repair/version specials parsing and its evidence**            | P0 calibration gate          | R7       | None; do before any model retuning           |
| [ ]  | **05 — Pair HTTP validators with the exact reusable result**         | P0                           | R1       | Rebase after 02b                             |
| [ ]  | **06a/06b — Separate count facts, estimates and UI denominators**    | P0                           | R5       | 04 before calibration claims; 06a before 06b |
| [ ]  | **07 — Persist full latest state and a durable revision**            | P0                           | R4       | 02b, 05, 06a                                 |
| [ ]  | **08 — Acknowledge/reconcile socket delivery and history revisions** | P0                           | R4/R2/R3 | 03, 07                                       |
| [ ]  | **09 — Isolate webhook delivery with a durable outbox**              | P0                           | R4       | 07                                           |
| [ ]  | **10 — Add explicit result phases and versioned model evaluation**   | P1; final-result safety gate | R7       | 04, 06a, 07                                  |
| [ ]  | **11 — Replace generic UI interaction machinery**                    | P1                           | R8       | P0 reliability tasks complete                |
| [ ]  | **12 — Consolidate backend protocol code only where justified**      | P2                           | R9       | Contracts stable after 01–10                 |
| [ ]  | **13 — Run cross-layer release rehearsal and document rollback**     | P0 release gate              | All      | Applicable fixes above                       |

Work serially by default. The independence of task 04 is not an instruction to
spawn another agent. If a task is deliberately deferred, record the reason, owner
and resulting release limitation; do not describe the queue as complete.

## 3. Decisions to use unless a test exposes a conflict

- Keep npm workspaces, ESM, the official XML adapter, pure shared core, SQLite/
  Drizzle, Socket.IO and collector ownership of persistence. No dashboard SQL.
- Use **TanStack Query** for browser HTTP state. Keep one socket subscription.
  Set polling/retry behaviour explicitly; `staleTime` does not schedule refresh.
- Keep history JSON **arrays initially**. Task 01 adds response headers and a typed
  internal read result; do not break every consumer with a new envelope just to
  expose freshness. Revisions are added compatibly in tasks 07/08.
- Initial policy values: proxy fresh TTL **10s**, live fallback maximum **120s
  since successful verification**, query polling **30s while visible**, HTTP query
  per-attempt deadline **8s**, total query retry budget **30s**, at most **two retries**
  for network/429/5xx errors. Test these
  with an injected clock; make policy values named/configurable, not scattered.
  Respect 429 backoff within a total request budget. Immutable archive data gets
  its own policy, not the live fallback expiry.
- “Last result changed” is not “last checked successfully”. A quiet count can
  contain old facts that are nevertheless verified current. A stale fallback
  must never advance its verification time merely because someone fetched it.
- Preferred UI primitive family: **React Aria Components**, subject to task 11's
  drawer/search spike. A documented Radix alternative is acceptable if it wins
  that comparison. Do not install multiple overlapping primitive families.
- Do not change probability constants, delete the place heuristic or replace
  its model with a new one as an incidental “cleanup”. Those need task 10's
  evaluation evidence and an explicit decision.

## 4. Task briefs

### 01 — Expose stale history and fix dependency verification

**Start in:** `packages/dashboard/server/history-upstream.ts`, `api.ts`,
`health.ts`, `collector-watchdog.ts`; `packages/dashboard/src/test/history-upstream.test.ts`.

**Changes**

1. Add an internal `HistoryRead<T>` containing data, state
   (`verified` / `cached` / `stale`), `verifiedAt` and optional failure reason.
   Timestamp only a successfully decoded/validated upstream response. Share
   concurrent refreshes for the same key; failures must clear the in-flight entry.
2. Preserve public array bodies on success. Set `Cache-Control: no-store` on mutable
   history responses and emit `X-Election-History-State` plus
   `X-Election-History-Verified-At` (ISO timestamp). Emit a bounded reason when
   stale. Return structured **503** when live data cannot be verified and the
   last verification is older than 120s, or no usable answer exists.
3. A collector 503 means unavailable, not an empty successful count. Preserve the
   existing explicit archive-year 404 semantics; do not cache an unavailable year
   as an immutable successful result. Distinguish a legitimate empty array.
4. Dependency verification must make a real bounded collector `/health` request;
   reuse/extract the watchdog's probe rather than fetching cached snapshots.
   Keep dashboard `/health` as liveness. `/ready` must not claim the dependency
   answered when a cached history value was substituted. Do not change Fly routing
   checks as part of this PR.
5. Add stale-serving age/verification-failure signals to the existing metrics
   owner. Keep labels bounded. Do not label series with revision IDs or errors.

**Required regression cases:** cache hit; refresh success; concurrent refresh;
network/500/503 failure with no cache; marked fallback before 120s; rejection
after 120s; unchanged healthy data reverified without inventing a vote change;
probe failure despite cached snapshots; eventual recovery. Assert headers and
HTTP bodies/status through `serveApi`, not only the internal cache function.

**Done when:** a stale response can no longer look like verified current data and
a cached response cannot make a failing dependency probe pass. No frontend rewrite
or database migration is required to land this task.

**Implementation record:** `3d6a87bbef17bb8fd8fe59692630a852596b45d6` on
`fix/task-01-stale-history`. `HistorySource` now returns `HistoryRead<T>` with
`state`, `verifiedAt`, a bounded `reason` and `unavailable`; a stale fallback is
served only within `DEFAULT_MAX_STALE_MS` (120s), and concurrent refreshes share
one in-flight request that is cleared on failure. `serveApi` keeps array bodies,
sets `Cache-Control: no-store` plus the three `X-Election-History-*` headers, and
maps unavailability to a structured 503 while preserving verified 404s. `/ready`
now calls the watchdog's shared `probeCollectorHealth`, which removed the cached
snapshot read entirely. Regression coverage: `history-upstream.test.ts` (cache,
refresh, concurrent sharing, network/500/503 with no cache, stale inside/outside
120s, reverify, recovery, allowed-404 non-caching, metrics) and `api.test.ts`
(status, array bodies, headers, 404 vs 503) plus `health.test.ts` (probe failure
despite identity). `npm run lint`, `npm run typecheck` and `npx vitest run`
(787 tests) pass.

### 02a/02b — Bound load, then isolate database work

**Start in:** `packages/collector/src/history-server.ts`, `db.ts`, `db/schema.ts`,
`voting-place-status.ts`, `index.ts`; existing history/pipeline tests.

**02a: bounded work**

- First add an offline load fixture/benchmark: full-size ballot, 1,440 changed
  snapshots, multiple different-seat requests, national history, writes and a
  retention sweep. Record query count, bytes, p95/p99 latency and event-loop delay.
  A small smoke variant must run in tests; the full benchmark can be opt-in.
- Replace per-snapshot N+1 reads with a fixed set of range queries grouped by
  snapshot. Add indexes only with `EXPLAIN QUERY PLAN`/fixture evidence; generate
  the Drizzle migration normally. Never edit a deployed migration in place.
- Add bounded time-window/page reads. Keep the existing array endpoints compatible
  for the current 24h window until the client migrates. Do not silently truncate
  history: return pagination metadata or an explicit range/limit error. Incremental
  revision cursors wait until task 07.
- Add a **service-wide** voting-place fetch budget, in addition to per-seat
  single-flight. Start with 12 active place-file fetches and a bounded queue;
  choose/document the queue limit from the fixture. Queue overflow/deadline is
  explicit unavailability, not “all places uncounted”. No unbounded promise fan-out.

**02b: worker ownership**

- Use a dedicated Node worker thread to own SQLite connections, migrations,
  writes, reads and maintenance. The dashboard still reaches it only through the
  collector API. Expose a typed, bounded worker request queue and readiness/failure.
- Await worker readiness before treating persistence as available. A startup or
  worker failure produces explicit unavailability, not an empty result set.
- Worker messages must be structured-cloneable. **Do not send `chanceFor`
  functions** from the current `writeResults` API across the boundary: calculate
  serialisable per-seat summary inputs in core/on the caller, or compute them
  inside the worker with an explicit baseline/config version.
- Preserve transaction atomicity, cycle filtering, newest-snapshot retention,
  disk-pressure pruning, migration ordering and orderly shutdown. All callers of
  the former synchronous DB functions must await their worker outcomes.

**Tests / done:** bounded query count, correct ordering/totals, queue overflow,
worker death, simultaneous write/read/sweep, disk-write failure and shutdown.
During an intentionally blocked DB job, collector `/health` must still answer;
history may report bounded unavailability, but may not hang indefinitely. Compare
the full benchmark before/after on stated hardware. Start with history p95 <1s
and no 5s upstream timeout at the agreed fixture load; document any unmet target.
Do not claim this proves the precise 7 November stall cause.

**Implementation record (02a):** grouped reads in
`packages/collector/src/history-queries.ts`, wired through
`history-server.ts`; evidence and the full before/after table in
`docs/history-load-baseline.md`. At 1,440 snapshots an electorate read fell from
2,881 statements / 51.4ms p95 to 3 statements / 26.1ms p95, and party history
from 2,883 / 50.0ms to 3 / 23.0ms. The snapshot list is 1 statement / 2.9ms.
Migration `0003_tricky_wild_child.sql` adds only the three indexes the
`EXPLAIN QUERY PLAN` output uses; a fourth candidate was measured and removed.
DB reads are bounded by `HISTORY_WINDOW_HOURS` (24) and paged with
`?limit=`/`?offset=` under `HISTORY_MAX_SNAPSHOTS` (2,000); an over-cap unpaged
window is an explicit 413 with `X-History-*` metadata, never a truncated array.
Consumers still receive plain arrays; Task 03 migrates them to follow paging.
The voting-place layer gained a service-wide 12-active / 64-queued fetch budget
with a 10s slot deadline, returning `reason: "busy"` on overflow instead of an
all-outstanding seat. Tests: `history-load.test.ts` (flat statement count, legacy
equivalence, paging, window), `history-server.test.ts` (headers, 400, 413,
window), and `voting-place-status.test.ts` (global cap, busy, recovery).
`npm run lint`, `npm run typecheck` and `npx vitest run` (800 tests) pass.
02b (worker ownership) remains open.

### 03 — Query-managed history refresh and recovery

**Start in:** `packages/dashboard/src/main.tsx` / app providers,
`hooks/useApi.ts`, `useVoteHistory.ts`, `useVotingPlaces.ts`,
`context/SocketProvider.tsx`, `pages/Trends.tsx`, `pages/Electorates.tsx`.

- Add one QueryClient. First migrate active national/electorate history to keys
  including cycle/resource/seat; consume task 01's headers and pass AbortSignal.
  Consume the response body within the request deadline, not just the headers.
- Preserve socket-triggered invalidation, add 30s polling while visible and
  focus/reconnect recovery. Do not refetch every inactive electorate on each tick.
  A notification during the proxy TTL may still read old data: polling must
  eventually recover; task 08 adds revision-aware invalidation.
- Preserve same-key data on refresh failure, display stale/error state and a retry
  action. Separate initial loading, valid empty count, unavailable, stale and error.
  Never show electorate A's data beneath B's name after changing query keys.
- When adding pagination in 02a, migrate query consumers to follow its continuation
  metadata and merge pages by stable snapshot identity; test a multi-page chart.
  Do not render a first page as if it were the complete night's history.
- Migrate voting-place refresh/retry so an initial failure does not prevent future
  polling. Completion can reduce frequency but must not permanently block
  corrections/final results. Do not rewrite unrelated local-state hooks.

**Tests / done:** keep Trends and an electorate mounted across three commits;
drop notifications; refocus/reconnect; fail the last notification's fetch; return
a stale proxy answer; switch electorates during a request; mount two consumers.
Verify eventual catch-up, request sharing, no wrong-seat flash, and honest states.

### 04 — Repair historical specials parsing and evidence

**Start in:** `scripts/measure-specials-swing.mjs`, its cache schema, new parser
fixtures/tests, `docs/seat-probability-model.md`, explanatory copy using statistics.

- Extract parsing/measurement into an importable, side-effect-free module so
  fixtures run without fetching archives or executing the CLI.
- Normalise summary headers, handling `TotalValidCandidateVotes`, spaced/case/
  punctuation variants and informal-vote columns. Map original column indexes to
  real candidate names; filtering headers must not shift numeric column alignment.
- Test that a summary column cannot enter the candidate map, become the “winner”
  or double totals. Reconcile real-candidate totals/specials/ordinary subtraction.
- Version parsed caches and derived outputs. Reject/regenerate old-format caches
  rather than continuing to trust their data. Preserve provenance/raw source.
- Regenerate affected statistics from available raw archives and document changes.
  If complete source data is unavailable, land the parser/tests and mark the
  calibration figures **unverified/pending regeneration**; do not invent replacements
  or tighten the model spread. This task is not a probability retune.

**Required fixture:** Candidate A=1,000, B=900, `TotalValidCandidateVotes`=1,900;
specials A=100, B=90, total=190. Only A/B may appear; measured totals are 1,900/190,
not 3,800/380. Add representative 2017, 2020 and 2023 header shapes.

**Done when:** the reproduced pseudo-candidate bug fails before/passes after,
legacy caches cannot silently reintroduce it, and every published calibration
figure is regenerated with provenance or explicitly flagged unverified.

### 05 — Pair HTTP validators with exact reusable bodies

**Start in:** `packages/collector/src/index.ts`, `scrape-cycle.ts`, `results.ts`,
`unchanged-cycle.test.ts` and conditional-fetch tests.

- Separate fetch observation state from the committed diff baseline. A reusable
  conditional-cache entry owns its body and Last-Modified together. A failed
  commit must leave the new body pending for retry or leave the old validator so
  the new body is fetched again. Fetch-state retention must not advance the
  committed diff baseline before the write succeeds. Acknowledged network delivery
  is a separate change in task 08, not a prerequisite to this regression fix.
- Preserve 304-without-body recovery, failed-seat fallback and quiet-cycle silence.
  Coverage/fetch degradation must remain visible even when counted facts match.
- Do not expand this PR into the durable latest-state/outbox design; task 07 owns it.

**Required failing integration:** commit/publish A=1,000; fetch B=2,000 with a
new stamp; fail that write once **before** cache update; next source replies only 304. After recovery, B must commit and publish without another source change or
restart. Also test mixed seats, cache-write failure and all-304 healthy silence.

**Done when:** no path pairs body A with validator B or clears a persistence error
merely because that mismatched body hashes like the previous publication.

### 06a/06b — Separate count facts, estimates and presentation

**Start in:** `packages/core/src/types.ts`, `sources/nz-election-xml.ts`,
`seat-probability.ts`, `notional-baseline.ts`, collector summary persistence,
dashboard `lib/seat-chance.ts`, `ElectorateCountBand.tsx`, Seats/Trends and `design.md`.

**06a: shared contract**

- Introduce a pure core `CountSummary` independent of candidate probability:
  counted facts by contest/basis; seat coverage; contributing places reported/
  total; ordinary completion; nullable ordinary/specials estimates with range,
  provenance and version. Keep geographically in-seat booth coverage separate.
- Preserve source counts and absence. Missing places data is not explicit zero;
  an estimate reaching 99% is not authoritative completion. Rename ambiguous
  internal place-fraction fields compatibly, then remove the old alias only after
  all consumers migrate. Validate the feed's `final` semantics before assigning
  an official-result phase; unknown is an acceptable state.
- Always include available counted facts in the national total. Include unreported
  seats in denominator coverage; if their totals cannot be estimated, show unknown
  progress rather than a falsely complete national percentage.
- Do not conflate turnout/ballot totals with valid candidate or valid party votes.
  Record the 1,276 difference between seat aggregation and the quoted national
  preliminary result as a reconciliation case, not a forced equality.
- Name the place extrapolation as a heuristic and expose its contribution. Keep
  it out of authoritative facts. Do not substitute the turnout-only estimate for
  model output without evaluation.

**06b: presentation**

- Amend `design.md`. Primary labels: “Voting places reported” (contributing set),
  “Election-night count complete”, “Estimated ordinary votes remaining tonight”
  and “Estimated specials to be counted later”. The map ledger explicitly names
  “booths in this electorate”; it cannot declare the whole electorate complete.
- Ordinary-progress bars retain that meaning through completion. Specials use a
  distinct labelled measure; do not switch the same bar's denominator. Unknown
  forecasts must not hide known votes or print “No votes counted yet”.
- Wire Seats, electorate band and persisted history through the same core summary;
  no page-local arithmetic forks. Do not reinterpret old history silently when
  its denominator/model version is unknown. Mark legacy points appropriately.

**Tests / done:** Mt Albert 24/24 geographical booths versus 90/102 contributing
places; Nelson 28,816 counted / 44.7% places with the old heuristic yielding about
35,649 remaining; one complete and one zero-result seat; missing enrolment or
baseline; missing versus zero place progress; all places complete below forecast;
candidate/party totals differ. A raw count correction may reduce votes/progress:
do not introduce an unconditional monotonicity clamp. Real-page mobile/desktop
captures must show stable labels/denominators before and after completion.

### 07 — Persist full latest state and a durable revision

**Start in:** collector persistence worker/schema/migrations, `index.ts`,
`history-server.ts`, core transport/history types, dashboard bootstrap/cache loading.

- Atomically store full latest payload, cycle-scoped monotonic revision, source/
  observation time, coverage, phase and model/config version. Associate nonzero
  count snapshots with that revision. Zero-vote ballots need durable latest state
  but still do not populate the count-history chart.
- Choose a publication/idempotency key once for a pending result and preserve it
  across downstream retries. A -> B -> A corrections need distinct revisions;
  do not make a globally unique content hash prevent the second A.
- Provide a cheap collector latest-state endpoint. Bootstrap dashboard full state
  from it on start/reconnect, even if the external feed is unavailable. Persisted
  authority must include parties/lists, not just electorate results.
- Extend history metadata compatibly with the committed revision and model/basis.
  Do not equate snapshot ID with revision if zero ballots or event-only commits
  make those sequences differ. Introduce revision cursors only now, with explicit
  pagination/completion metadata and old-read compatibility.
- Treat JSON as an atomic replaceable cache and the diff baseline as a separate
  concern. No migration or upgrade should discard the existing night's history.

**Tests / done:** transaction rollback; downstream retry creates no second commit;
crash after commit/before notification; restart with the feed down; zero ballot;
wrong cycle; correction A -> B -> A; old schema migration. Fresh dashboard boot
must recover all three result collections without waiting for a new feed change.

### 08 — Acknowledge delivery and coordinate history by revision

**Start in:** `collector/src/ws-client.ts`, dashboard `server/index.ts`,
`feed.ts`, core socket types, browser SocketProvider/query invalidation.

- Use Socket.IO ack/timeouts and bounded retry; validate cycle/schema before
  acceptance. Acknowledge accepted duplicates without deriving duplicate events.
  Ignore/reject older revisions within the same cycle. Do not claim exactly-once
  network delivery.
- On reconnect reconcile/resend latest committed state, even when no newly changed
  result is queued. Keep the latest pending _state_, not ten obsolete payloads.
  Recover historical commentary separately if it requires durable event replay.
- Scope feed-event IDs/dedup to durable revision and event identity. Optional
  commentary failure must not prevent acceptance of current state.
- Add `X-Election-Revision` to history metadata where known; invalidate mutable
  proxy entries on accepted commit notifications. Browser queries compare target
  and served revisions and keep retrying within policy when behind. A response
  predating a notification must not be marked caught up. Keep polling as backup.

**Tests / done:** connected-send loss, lost ack, duplicate delivery, older revision,
dashboard-only restart during all-304 polling, collector reconnect with no new
facts, last-notification request racing the proxy TTL. Tables/history converge
without manual navigation and without duplicate feed events.

### 09 — Deliver webhooks independently through a durable outbox

**Start in:** collector `results.ts`, `retry.ts`, persistence schema/worker,
`index.ts`, webhook metrics/tests.

- Persist event/outbox entries with the result transaction. Give each event a
  stable idempotency ID and store the prior announced call state/model context;
  don't reconstruct what was announced using the new payload's swing lookup.
- Deliver after commit, outside collection/live-publication sequencing. Bound
  concurrency, request deadlines, total retry budget and retained outbox size.
  Store retry eligibility and terminal failure; don't busy-loop poison messages.
- External receiver idempotency is required for at-least-once delivery. A hung
  receiver cannot block current results. No Redis/BullMQ service is required.

**Tests / done:** hanging receiver; temporary 429/5xx; permanent 4xx; lost response
after receiver acceptance; restart with pending outbox; dead-letter/retention
limit; call crossing/withdrawal dedup. Count publication continues throughout.

### 10 — Result lifecycle and model evaluation

**Start in:** core model/input/output types, source phase mapping, forecast UI/
feed copy, `scripts/validate-seat-probability.mjs`, versioned fixture/report storage.

- Explicitly distinguish ordinary counting, preliminary complete/specials pending,
  official result and unknown phase. Final results cannot invent outstanding
  specials or present a forecast as a counted fact. Unknown phase is not final.
- Record raw-source/config/model versions and as-of timestamps within a stated
  storage/retention budget. Evaluate without future constants leaking backwards.
- Review the specials random variable against its measurement, candidate covariance
  and three-way allocation. Reconcile contradictory comments/copy. Use task 04's
  regenerated evidence, not the contaminated statistics.
- Produce an offline deterministic report with candidate outcomes, ordinary/final
  survival distinguished, calibration bins, Brier/log loss and interval coverage;
  compare simpler baselines and account for correlated checkpoints.

**Done when:** final/unknown-phase regression tests, probability invariants and
three-way/completion cases pass, and an evaluation report states limits. Record
any proposed parameter change separately for approval. If calibrated final-seat
claims cannot be supported, make that limitation explicit rather than tuning until
the example looks reassuring.

### 11 — Replace generic UI behaviour, not the editorial design

**Start in:** `WinPercentDrawer.tsx`, `BottomSheet.tsx`, `ElectorateSearch.tsx`,
`MapControls.tsx`, UI wrapper/lint setup; retain `design.md` tokens.

- Spike one shared modal wrapper and the electorate combobox using React Aria
  Components. Keep the library if it removes app-owned focus/keyboard/dismissal/
  scroll machinery and meets visual/accessibility checks. Document why if choosing
  Radix instead; do not combine overlapping families just to complete the spike.
- Preserve existing component entry points, multi-trigger focus return, safe areas,
  dark mode, reduced motion and Leaflet stacking. Include new maintained wrappers
  in ESLint rather than hiding them under the current `components/ui/**` ignore.
- Check existing dnd-kit reuse for chamber interactions separately; keep domain
  geometry/custom visualisations. Do not install a data grid or rewrite every
  table/chart without a measured reduction in owned behaviour.

**Done when:** Tab/Shift-Tab containment, background inertness, nested Escape/
scroll restoration, keyboard/touch search, macron matching and focus return pass;
real-browser screenshots at 360/390px and desktop in both themes are reviewed.
Record behaviour code deleted, wrapper code added and bundle/dependency delta.
A browser test dependency is permitted; never add a browser to the collector.

### 12 — Conditional backend consolidation

- Use existing Zod for shared runtime boundary schemas, deriving TS types where
  possible. Pure internal reducers should not repeatedly revalidate the same data.
- Fix method/URL/parameter/error handling; make year filtering supported end-to-end
  or explicitly reject it. For split publishers, require authentication rather
  than treating `ALLOW_REMOTE_RESULTS` as permission for any remote sender.
- Only then spike Hono on one history route, preserving node:http/Socket.IO,
  metrics route labels, status/headers, SPA fallback and cancellation. Keep it only
  if it demonstrably deletes protocol code/improves tests. No automatic migration
  of every route; a documented “do not adopt” is a valid completed spike.
- Native fetch remains fine. Introduce p-retry or another helper only where it
  replaces actual bounded retry policy; tiny correct helpers need not be replaced.

**Done when:** the migration/defer decision is recorded with before/after evidence,
runtime boundary tests cover malformed input and methods, and production dependency
audit passes. No framework change is required to close P0 reliability tasks.

## 5. Task 13: release rehearsal and global definition of done

Run against the existing offline XML mock plus a fault-injection harness. No
live Commission feed or production credentials should be needed in CI.

| Scenario                                                            | Required observable result                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Source continues; historian HTTP is unavailable                     | Live state/persistence may advance; history is visibly stale, then unavailable within policy; no false readiness |
| DB write fails after successful A, before caching B; feed then 304s | B is recovered and committed without a restart/source change                                                     |
| Browser misses final socket notification / fetch fails              | Poll/focus/reconnect recovery catches up without navigation                                                      |
| Many different seats + national history + write/sweep               | Bounded fan-out/queries/queues; collector health remains responsive; documented latency results                  |
| Dashboard-only restart; source unchanged                            | Full state, including parties/lists, recovers from durable latest revision                                       |
| Commit succeeds; notification/ack lost                              | Retry/reconciliation converges without duplicate derived events                                                  |
| Webhook receiver hangs                                              | Collection and current-result delivery continue; outbox state explains failure                                   |
| All ordinary places reported; specials pending                      | Ordinary count complete; separately labelled specials estimate; stable bar meaning                               |
| Official result or unknown phase                                    | No fictional outstanding specials/final-result assertion                                                         |
| Correction reduces a vote count                                     | A new ordered revision, not discarded as impossible or hidden by a clamp                                         |
| Legacy parser cache / summary column                                | Rejected or regenerated; never a candidate/calibration datum                                                     |

For each PR, run focused regressions and then:

```bash
npm run build:core
npm run lint
npm run typecheck
npx vitest run
```

Check formatting **only for files in that PR**; do not run root `npm run fmt` over
unrelated user changes. Database changes need migration-from-existing-data tests
and rollback/backup instructions; UI changes need real-browser verification.

Before requesting deployment approval, supply:

- Task ledger updated with PR/SHAs and any deliberate deferrals.
- Regression evidence, full-suite results and measured load-test hardware/results.
- Schema/contract compatibility across an upgrade and rollback; feature flags where
  needed. Never roll back by deleting the election-night database.
- A diagnostic/runbook template containing environment, host/app/machine, deployed
  SHA, source URL, election year, poll mode, revision and UTC/NZDT timestamps.
- Retention/export instructions preserving raw/derived evidence beyond 24h.
- A proposed deployment/rollback procedure, **not an unrequested deployment**.

### Completion note template

```text
Task: <ID and title>
Starting SHA / PR / ending SHA:
Behaviour changed:
Regression that failed before and passes now:
Focused and full verification:
Compatibility / migration / rollback:
Measurements or visual evidence:
Known limitations / next task:
Production actions taken: none (unless explicitly authorised)
```

The implementing agent's first deliverable is task 01's regression and bounded
stale-history fix, not a new architecture proposal or a large all-in-one rewrite.
