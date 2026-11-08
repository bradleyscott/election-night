# Architecture and approach review

**Date:** 8 November 2026  
**Baseline:** review began at `d29ab09`; reconciled with `989c40b` and remaining working-tree changes as the checkout advanced during review.  
**Purpose:** prioritised implementation hand-off, not a redesign or an incident postmortem.

**Implementing agent: start with the [implementation plan](implementation-plan-2026-11-08.md).**
It is the single source of execution order, task boundaries, defaults, regression
cases and completion criteria. This document supplies rationale/evidence for R1–R9,
not a second task queue.

**Evidence update:** [Election-night operational review](election-night-2026-11-07-review.md)
now reconstructs the run from prior OpenCode tool outputs, retained production
history and Fly releases. It supersedes this review's original lack of incident
evidence and refines execution order: R3/R6/R2 first for serving reliability,
R5 for denominator clarity, and the R7 historical-parser defect before further
probability calibration claims. R1 remains a reproduced bug, not the established
cause of the observed history-serving outages.

## Executive assessment

Keep the monorepo, pure shared core, official XML connector, SQLite ownership in
the collector, and the editorial design system. These are appropriate choices
for a small, single-machine election service. The project already uses substantial
libraries: React, React Router, Leaflet, Recharts, Floating UI, dnd-kit, Socket.IO,
Drizzle, better-sqlite3, Zod and an XML parser. It does not need a new stack.

The most important problems are **incomplete consistency and freshness contracts**:

1. HTTP validators can advance without retaining the result they validate. A
   failed database write can therefore lose a fetched update on the next 304.
2. Browser history originally used one-shot HTTP reads. The checkout now includes
   socket-triggered refetching, but no independent refresh/retry recovery: a missed
   notification or a stale response on the last update can still leave it behind.
3. The history proxy silently serves arbitrarily old cached responses during
   failures, and readiness can mistake that fallback for a reachable collector.
4. Official reporting progress, estimated votes remaining tonight, and estimated
   specials are presented through overlapping names and a changing denominator.

Use libraries to remove generic interaction and request-state machinery, not
election-specific explanations or calculations. **TanStack Query and one headless
UI primitive family are the strongest adoption opportunities.** Backend library
replacement is lower priority than fixing state ownership, delivery semantics,
bounded database work and runtime validation.

### Scope and confidence

- Reviewed the collector loop, conditional fetching, caches, persistence, history
  queries and proxy, socket delivery, readiness, count model and its consumers,
  representative UI controls, deployment and existing validation/tests.
- Read the existing uncommitted changes and reconciled concurrent commits. These
  include updated 2026 constants, all-reported places overriding the turnout
  forecast, socket-triggered history refetching, fatal HTTP-listener errors and a
  dashboard-side collector watchdog. Those are useful fixes, not recommendations
  to reimplement from scratch. Remaining line references identify reviewed regions;
  exact line numbers can shift as these changes land.
- No existing user files were changed. This document is the review deliverable.
- At the initial architecture-review stage, no production logs, production database, deployed SHA or overnight metrics were
  retrieved. Findings below establish code paths and local reproductions, **not
  which path caused each reported incident**. The linked operational follow-up
  adds historical evidence and separates confirmed symptoms from root-cause hypotheses.
- This is not a complete security audit, visual/browser audit or probability-model
  certification. Library capabilities were checked against the references at the end;
  compatibility, bundle cost and exact versions still need checking when adopted.

## Implementation order

Use the task ledger in [the implementation plan](implementation-plan-2026-11-08.md#2-execution-order-and-completion-ledger).
It consolidates the initial recommendations and incident-driven reprioritisation,
splits large findings into PR-sized tasks and identifies fixes already present.
R1–R9 below remain stable finding IDs, not chronological steps. Begin with plan
task 01 (R3: stale-history visibility and dependency verification), then the bounded
serving work; do not start with a wholesale UI or backend-framework migration.

## Current architecture: retain the boundaries, repair the joins

```text
Commission XML
    -> collector fetch/reduce
        -> SQLite history
        -> webhook diff/delivery
        -> electorate-only JSON cache
        -> Socket.IO publish
             -> dashboard server latestResults + derived feed
                  -> browser current results

browser history -> dashboard HTTP proxy/cache
                    -> collector HTTP API -> synchronous SQLite reads
```

The separation of a pure core from I/O is good. So are transactionally written
snapshots, cycle-scoped history, conditional GETs, partial-seat fallback, metrics,
an offline mock feed and integration tests. There is no reason to put SQL in the
dashboard server, move to microservices, replace XML with scraping, or remove
Socket.IO merely because another transport could work.

The weak join is that these outputs do not carry a common durable revision or a
shared account of freshness. “Fetched”, “committed”, “sent”, “received” and
“displayed” are treated too similarly. Several caches separately decide what is
current, and source timestamps are not consistently distinguished from checks.

## R1 — Keep conditional validators attached to their exact bodies

**Evidence:** `packages/collector/src/index.ts:190–220,256–285` advances
`feedStamps` immediately after fetching, before `writeResults` and `cacheResults`.
`packages/collector/src/scrape-cycle.ts:220–228,277–305` obtains the body to reuse
on a 304 from `readResults()`, the previous publish/diff cache.

Failure sequence:

1. Result A is committed/cached/published with timestamp A.
2. Result B is fetched with timestamp B; the loop remembers timestamp B.
3. The database write fails before `cacheResults(B)`.
4. The next request sends timestamp B and receives 304.
5. The scrape reuses body A but labels it with timestamp B. Its counted-facts
   signature can match the last successful publication, so the cycle reports no
   change and clears its error. Recovery may require another upstream change or
   a restart.

**Locally reproduced:** a fake conditional source fetched 2,000 votes; after
simulating the failed-write boundary by not caching that body, the next scrape
with its returned stamps reused the old 1,000-vote body. It reported one healthy
`unchanged` electorate. This directly contradicts the intended retry guarantee in
the loop's comments.

**Implementation brief**

- Immediate safe fix: do not promote new validators until the corresponding
  result is retained for reuse. On persistence failure, either keep a pending
  exact payload to retry or retain the old validators and refetch the new body.
- Preferred ownership: a fetch cache contains `{body, lastModified, checkedAt}`
  per seat, independently of the committed diff baseline. Updating the fetch
  cache must not imply successful persistence, webhook delivery or broadcast.
- Never persist validators without their matching bodies. Preserve the existing
  no-body-on-304 recovery and per-seat partial-failure fallback.
- An unchanged but degraded scrape must retain coverage/fetch-error information;
  `signature === lastPublishedSignature` is not proof all seats were checked.

**Acceptance tests**

- Successfully commit A, fetch changed B, fail the DB write once, then return only
  304s. B must eventually commit and publish without a process restart.
- Repeat with one changed seat among otherwise unchanged seats and with a failed
  cache write. Assert validators, bodies and source timestamps stay paired.
- A genuinely quiet healthy cycle still writes no duplicate history snapshot.

The existing `unchanged-cycle.test.ts` failure test starts without a successful
baseline and fails _after_ the DB write at the cache path. `cacheResults` assigns
its memory cache before writing the file. It therefore does not cover this bug.

## R2 — Make HTTP history an actively maintained query

**Evidence and existing fix:** the initial reviewed `useApi.ts` ran on URL/tick
changes only, and history consumers never called `refetch`. Commit `4d038b9`, now
present in the checkout, adds `refreshKey` and keys both history hooks to the socket's
`resultsUpdatedAt`. Preserve that regression coverage. The remaining gap is that
`packages/dashboard/src/hooks/useApi.ts` still has no polling, focus recovery or
automatic error retry. If the socket-triggered request fails or receives a cached
older response, there may be no next trigger after the final result. Trends also
ignores the hook's `error` and can render a fetch failure as “Waiting for more results”.

**Recommendation: adopt `@tanstack/react-query` for HTTP server state.** Keep
Socket.IO for pushed results; do not open another socket per query.

**Implementation brief**

- Provide one QueryClient in the app. Start with history, then migrate runtime
  config, prior results and voting-place queries as appropriate. Keep local UI
  selections in React state; they are not queries.
- Keys include cycle, resource and electorate, e.g.
  `['history', year, 'electorate', name]`. Pass AbortSignal to fetch and validate
  responses at the boundary.
- Explicitly configure active-history polling (suggest 30s initially), refetch on
  focus/reconnect, bounded retry and query retention. **`staleTime` is not a polling
  interval**, and adding Query alone will not fix this issue.
- Preserve existing socket-triggered refresh and migrate it to query invalidation.
  R4 supplies an authoritative committed revision instead of a browser receive
  timestamp. Keep polling as recovery when notifications are missed.
- Coordinate proxy invalidation with R3 so event-triggered fetches do not simply
  receive a still-fresh 10s-old proxy entry and then stop refreshing.
- Keep previous _same-key_ data during a refresh error with a visible stale/error
  state and retry control. Do not show electorate A's result under B's title while
  changing keys. Do not collapse unavailable, empty, loading and failed into one
  awaiting-results screen.
- Prior-cycle results can use long freshness windows once successfully loaded;
  transient “unavailable” needs a retry policy. Voting-place retries must work even
  when the first request fails: its current timer starts only after a summary exists.

**Acceptance tests**

- Leave Trends and an electorate open across three commits; their histories
  advance without navigation/reload. Reconnect and refocus catch up.
- If the socket notification is missed, polling still catches up. Repeated
  consumers share a request; requests are cancelled on key changes.
- An upstream failure preserves existing data with an explanation; recovery
  removes that explanation. An initial failure shows an error, not no votes.
- A completed ordinary count can still refresh for corrections/official results;
  stopping updates permanently at “all places reported” is not sufficient.

## R3 — Make freshness and degradation part of the API

**Evidence:** `packages/dashboard/server/history-upstream.ts:58–141` stores only
an expiry and value, and serves the cached value on transport and most HTTP errors
without a maximum age. `server/api.ts` sends it as ordinary JSON/200.
`server/health.ts:58–64` uses the same cached method for reachability, so stale
fallback can make readiness report `history: upstream` while that upstream is down.
503 becomes an empty result rather than an explicit unavailable state.

The existing tests intentionally verify fallback, not a freshness bound. A 10s
TTL alone cannot explain indefinite staleness on a healthy upstream: the larger
problems were missing browser refresh and unmarked error fallback. Even with the
new socket-triggered refresh, a last notification inside the proxy TTL can read
the old entry and have no later trigger.

The checkout now includes `server/collector-watchdog.ts` (`94c2be8`), probing real
collector HTTP health and restarting the combined machine after sustained failure,
plus fatal collector listener errors (`4d038b9`). Keep these containment fixes.
They do not make stale API data distinguishable, retry a browser's failed query,
or prove data correctness when `/health` answers successfully.

**Implementation brief**

- Introduce a shared history response envelope, or equivalent documented metadata:
  `electionYear`, `latestRevision`, `latestCommittedAt`, `generatedAt`,
  `lastVerifiedAt`, `stale`, `staleReason`, and `data`. Freshness must come from
  the server, not from when the browser received JSON.
- Distinguish “latest recorded change” from “successfully checked and unchanged”.
  A history ending hours ago can be correct after counting stops; a recent HTTP
  response can still contain old data. Revision lag against the collector is the
  correctness signal, not just wall-clock age of the last vote change.
- Give live-history fallback a configured maximum time since successful upstream
  verification (initial proposal: two minutes), and return explicit unavailability
  beyond it. Inside that window, retain usable data but mark degradation. Use a
  separate policy for immutable archives. Do not turn arbitrary 503s into success.
- Add per-key in-flight request sharing; bound/expire cache storage. Invalidate
  mutable history on a commit notification. If a response predates the requested
  revision, do not mark the query caught up.
- Set deliberate HTTP cache policy for mutable endpoints so browser/proxy caching
  does not create a fourth undocumented freshness policy.
- Liveness should remain cheap and separate from dependency health. Readiness or
  a diagnostic status endpoint must use a real bounded probe, not stale fallback.
  Do not eject the only serving machine solely because old useful data exists;
  document routing readiness separately from “data current”.
- Publish stage status: last source check, coverage, last committed revision,
  last acknowledged delivery and history response revision. Replace the current
  `Live` inference (`connected && results !== null`) with separate connection and
  data-health language. Browser connection is not collector health.
- Extend existing Prometheus/Grafana work with commit/delivery/served revision
  gauges, stage-success timestamps and stale-response age. Put revisions in gauge
  values/logs, **not labels**. Page on lag while source changes, write failures,
  sustained fallback and failed verification, not on a naturally quiet feed.
- The current Fly configuration has moved to a **daily quiet-period poll**
  (`POLL_INTERVAL_MS=86400000`). Make freshness expectations/cadence explicit and
  ensure alerts distinguish that planned mode from a stalled live collector.
  Restore/verify live cadence before another count; a watchdog restart is not a
  substitute for timely collection. Avoid letting an expensive-history timeout
  induce a restart loop that repeatedly reloads the source and clears useful state.

**Acceptance tests**

- Prime a cache, stop the upstream and advance time past both TTL and max-stale.
  Verify marked fallback, then explicit unavailability, and eventual recovery.
- During that outage, a real dependency probe must fail even if cached snapshots
  exist. Historical no-change alone must not be called an outage.
- Quiet healthy polls, partial source failures, write failure, socket disconnect
  and stale proxy fallback are distinguishable in status and metrics.

## R4 — One durable latest result, with revisions and recoverable delivery

**Evidence:** `packages/collector/src/ws-client.ts:9–20,59–75` has a process-local
queue and plain `emit`, not an acknowledgement. The loop records publication
success after `emit` returns. The dashboard caches only electorate results on disk
and boots with empty `partyVote` and `partyLists`
(`packages/dashboard/server/index.ts:64–77`). On a server-only restart, a collector
with no pending result and an unchanged feed has no reason to resend its full
payload. The server can remain incomplete until the next counted-facts change.

Socket.IO preserves message ordering, but its default delivery is **at most once**.
The current queue does not close the disconnect-during-send gap. Also,
`await processResults(...)` sits between DB commit and live publication; webhook
requests use a retry helper with no explicit request deadline.

**Implementation brief**

- Within the collector's persistence boundary, atomically store an authoritative
  full latest payload and a monotonically increasing cycle-scoped revision.
  Associate a history snapshot with that revision when votes exist; a zero-vote
  ballot still needs restart-safe latest state without filling the history chart.
- Return the committed revision from persistence. Record source/observation times,
  coverage, result phase and model/config version. A signature is a dedup aid, not
  proof of persistence or a globally unique event identity: A -> B -> A corrections
  must remain representable.
- Expose a cheap full latest-state endpoint from the collector. Dashboard boot and
  reconnect recover from it, including when the source is unavailable. Keep DB
  ownership in the collector. JSON, if retained, is an atomic replaceable cache,
  not the authority shared with the webhook diff baseline.
- Use Socket.IO timeout/acknowledgement support with bounded retry. The server
  validates cycle and schema, accepts newer revisions, acknowledges duplicates,
  and does not replay derived feed events for a duplicate revision. Acknowledge
  only after the agreed acceptance boundary; optional commentary failure must not
  hold current results hostage.
- Resend/reconcile latest state on collector reconnect, even if there is no queued
  new change. For _state_ replication, retain the newest pending state rather than
  ten obsolete full payloads; deliver _events_ through their own durable cursor.
- Persist webhook events/outbox records with the commit and deliver separately,
  with stable event IDs, bounded concurrency, deadlines and retries. Do not claim
  exactly-once external delivery: a receiver needs idempotency for retries.
- Store previous derived call state/model version or evaluate previous and current
  payloads with their respective swing contexts. The current diff evaluates both
  through the current cycle's chance lookup (`results.ts:162–178`), which is not a
  reliable record of what was previously announced.

**Acceptance tests**

- Restart only the dashboard after a successful publish; return only 304s from the
  feed. All current-result tables recover fully without a new source change.
- Drop the collector connection at send time; lose an ack after acceptance; retry.
  Latest state catches up and no duplicate feed/webhook event is created.
- Kill the collector after commit but before notification, then restart while the
  feed is down. Recover the committed payload and deliver pending work.
- A hanging webhook cannot delay current results or the next collection cycle.
- Rejected/invalid/wrong-cycle results cannot be counted as acknowledged success.

## R5 — Give facts, estimates and completion different contracts

### Confirmed sources of confusion

1. **The same bar changes its denominator.**
   `ElectorateCountBand.tsx:130–145` uses `chance.progress` while counting, then
   `counted / (counted + specials)` at completion. A near-100% bar can drop to
   approximately 86% without losing any counted votes. Meanwhile Seats reaches
   100% of the ordinary night. The text changes, but the visual quantity changes too.
2. **Useful official facts are dropped.** `NzElectionXmlSource.parseNationalStatus`
   reads national totals, electorate completion, specials and update time, but
   `buildResultsPayload` retains the party allocation and not these statistics.
   Per-seat total/count of places, result `final` and body update attributes are
   also not carried through `parseElectorateXml`. Do not assume `final` means the
   certified official result; verify the feed's semantics before mapping it.
3. **The place “floor” is an estimate, not a lower bound.**
   `nightRemaining` computes `counted * (1-p)/p`, equivalent to assigning the
   average reported-place vote count to each unreported place. At 20,000 votes
   and half the places reported, it infers another 20,000. The missing places
   could actually hold 100 or 40,000 votes. Taking the maximum with a turnout
   forecast is a conservative heuristic, not a mathematical guarantee. When it
   binds, vote progress is exactly the place fraction it ostensibly avoids using.
4. **Unreported electorates disappear from national progress.**
   `countProgress` skips zero-vote electorates and seats with no enrolment estimate.
   A local probe with one complete 20,000-vote electorate plus one unreported
   electorate returned national `fraction: 1`. Its “votes counted” can also omit
   counted votes from seats lacking a usable denominator.
5. **Missing and zero place progress are conflated.** The parser defaults missing
   place percentages to zero; the model treats zero as unknown. With no known
   place progress, reaching 99% of a forecast declares completion, even without
   authoritative evidence that reporting has ended.
6. **One turnout total is used for different contests.** `votesCounted` comes from
   `total_votes_cast`, while candidate share/margin calculations divide candidate
   votes by it. Establish whether it is party ballots, total papers, or a count
   including informal votes for each supported feed. Valid party votes, valid
   candidate votes and turnout are not interchangeable denominators.

The completion override, now committed as `989c40b`, addresses phantom votes after
all places report. The new 2026 constants improve today's estimate. Neither solves the
underlying naming, coverage, future-phase or provenance issues.

**Implementation brief**

- Preserve official statistics with exact source field, units, source timestamp
  and provenance. Keep official national aggregates separate from the sum of seat
  files: files fetched sequentially are not an atomic Commission snapshot.
- Introduce a pure core `CountSummary` independent of `SeatChance`, containing
  counted totals per contest, known/expected electorate coverage, official places
  reported, ordinary-count status, and nullable estimated ordinary/specials
  remaining with basis, range and model version. UI count facts must work even
  without a baseline, turnout estimate or two candidates.
- Rename misleading internal fields, especially `votePercentageCounted` when it
  actually means `placesReportedFraction`. Preserve absence as `null`/unknown and
  distinguish it from an explicit zero. Prefer counts over a rounded percentage
  for exact all-reported detection when the feed publishes both.
- In national summaries, always sum all available counted facts. Include expected
  contributions from zero-result seats where defensible; otherwise show incomplete
  coverage and no national vote-progress percentage. Never drop them silently.
- Use fixed meanings in the UI. Recommended primary status: **“Voting places
  reported: X / Y (Commission)”** and, once complete, **“Election-night count
  complete”**. Separately show **“Estimated ordinary votes remaining tonight:
  about N”** and **“Estimated specials to be counted later: about S”**. If vote
  progress remains, label it “Estimated share of tonight's vote counted”. Do not
  call a place percentage a vote percentage.
- Do not swap a completed ordinary-progress bar into a final-vote-share bar.
  Keep ordinary completion at 100%; specials get a separately labelled measure.
  Amend `design.md` intentionally and update the shared summary's consumers.
- Treat the place-size extrapolation as a named, testable heuristic with uncertainty,
  not a fact. Do not just delete a safeguard that prevents premature confidence:
  compare alternatives in R7 before changing the projection. Weighted place
  history is a possible later improvement, not a reason to fetch thousands of
  booth files on every poll.
- Use official specials estimates when published _and their meaning is verified_.
  Do not equate all `NationalStatus` fields with votes remaining based on their
  names. A national estimate does not become a measured per-seat number merely
  because historical ratios apportion it. Keep estimates rounded and labelled.
- Version cycle assumptions with source/citation, publication/as-of time and
  preliminary/final status. Do not silently apply knowledge published after
  election night to earlier model checkpoints or label preliminary turnout final.

**Acceptance tests**

- Unequal booth sizes; all places reporting below forecast turnout; votes exceeding
  the forecast with places missing; absent place data versus explicit zero;
  unknown enrolment; an unreported electorate; no baseline; one candidate;
  different candidate/party totals; partial/mixed-age source payloads.
- Ordinary completion is consistent on Seats, electorate panel and history.
  Specials stay separate and no bar changes its meaning at completion.
- Reconcile ordinary counted totals and place counts against recorded Commission
  payloads; explain any difference rather than forcing aggregates to match.

## R6 — Bound history work before adding infrastructure

**Evidence:** `packages/collector/src/history-server.ts:122–210` returns all
retained snapshots and issues two additional queries per snapshot for electorate
and party histories. At 1,440 changed snapshots this is roughly 2,881 SELECTs
per history response, plus full JSON materialisation. The electorate-oriented
lookup also lacks an electorate-leading index in `db/schema.ts`.
`db.ts` writes rows individually inside a transaction; writes, reads, pruning and
compaction all run synchronously on the collector's HTTP/event loop. A second
read-only SQLite connection is **not** a separate execution thread.

These are confirmed scaling shapes, not a measured cause of last night's timeout.
The operational follow-up confirms that SQLite writes continued while HTTP serving
failed and that restart/resize restored service. This promotes isolation/load
control to P0, but still does not prove which synchronous operation or resource
condition caused the stall.
The recent metrics merge timeout/cache fix and `docs/observability.md` already
identify collector event-loop contention. A longer history timeout alone treats
the symptom, and refreshing all visitors more often makes this more important.

**Implementation brief**

- Measure a realistic busiest-night fixture: changed snapshots, full ballot, 24h
  retention, concurrent history clients and a retention sweep. Record DB read/write
  time, serialized bytes, event-loop delay, disk/WAL size and request p95/p99.
- Replace N+1 reads with a bounded set of range queries, grouped in memory, using
  prepared statements/Drizzle appropriately. Verify index choices using
  `EXPLAIN QUERY PLAN`; candidates include `(electorate, scrape_id)` and
  `(election_year, id)`, based on actual queries and fixture measurements.
- Bound voting-place work across the service, not just within each electorate's
  request. `VotingPlaceStatusService` currently permits six simultaneous fetches
  per electorate; same-seat single-flight does not cap many different seats.
- Offer bounded `afterRevision`/cursor and time-window endpoints, with a maximum
  page size. Keep chart/downsample reads separate from detailed candidate history;
  a national chart should not need every candidate/list row.
- Have database operations owned by a dedicated worker thread with its own SQLite
  connection(s), serialised writes and bounded job queue. The collector HTTP loop
  remains responsive while that worker writes or compacts. Use Node worker_threads,
  not a new job platform. Load-test simultaneous reads/writes and busy handling.
- Preserve atomic snapshots and completion visibility. R4's unique revision makes
  a retry idempotent rather than creating another full snapshot after a downstream
  cache/webhook failure.
- Keep disk-pressure retention, but separate hot operational retention from an
  explicitly retained/exported election-night record. Today's 24h window (or 1h
  under pressure) cannot also be the permanent replay/audit archive. Define its
  backup/export destination and retention policy before relying on it as evidence.
- Initial performance target to validate on Fly-equivalent hardware: cached latest
  status under 100ms, bounded history p95 under 1s, and no 5s upstream timeout
  during the fixture/sweep. Adjust from measurements, not a developer laptop alone.

**Acceptance tests:** bounded query count and response size, pagination with no
missing/duplicate revisions, concurrent commit/read/retention consistency, worker
failure reporting, disk-full recovery, and the benchmark above. Do not introduce
Postgres, Redis or a distributed queue unless measured limits justify their cost.

## R7 — Treat probability as a versioned forecast with a result lifecycle

**Evidence and limitations**

- `SeatChance` has waiting/counting/complete, where complete still assumes all
  specials are outstanding. Archived/final data sent through the same call can
  therefore keep projecting specials after they have already been counted. There
  is no explicit official-result lifecycle in that input contract.
- Code/module documentation and `docs/seat-probability-model.md` contradict each
  other: the introduction excludes specials, later sections include them; completed
  states are described as having no probability even though they carry one.
- The validation script is valuable, but uses party votes as pseudo-candidates and
  an invented arrival order. Its documented 27-seat/374-checkpoint score is not a
  calibration certificate for candidate win probabilities including specials.
- It uses hindsight cycle constants; a changed 2026 row cannot by itself explain
  what the model knew at 8pm the previous evening.
- The claim “specials always reduce count-only probability” is not generally true:
  adding symmetric variance moves a normal CDF toward 0.5. For a projected leader
  with negative mean, it increases that leader's probability. Test the claim, not
  just typical positive-margin examples.
- The implementation's specials CDF treats the specials' leader-minus-runner
  differential as zero-centred, but its documentation/measurement describe the
  _difference from the ordinary-count differential_. Those are different random
  variables. `margin / specials` is the required net challenger advantage, not
  automatically the additional swing relative to the ordinary split. This needs
  an explicit equation-and-measurement review before tuning the standard deviation.
- The residual chance of a third candidate is heuristic, capped, and disappears
  from the complete-state contract. Complete-state top-two chances can allocate
  the whole probability to two candidates even in a genuinely three-way contest.
- **Historical data defect now evidenced:** the Nelson overnight session found
  `TotalValidCandidateVotes` being treated as a candidate in 2017/2020 caches.
  This review reproduced it in the current parser: its `Total Valid` filter misses
  the unspaced header. Correct the parser and invalidate/regenerate versioned
  derived evidence before trusting the published spread/calibration statistics.

**Implementation brief**

- First add explicit phases: awaiting results, ordinary counting, preliminary
  complete/specials pending, official result, and unknown phase. Verify how the
  source signals each; date alone and all-places-reported are not certification.
  Final results must not invent outstanding specials or display a forecast as fact.
- Before model tuning, add archive-header fixtures and candidate/aggregate
  reconciliation tests, fix the summary-column parsing defect, regenerate caches
  under a new parser version and update all affected statistics/copy. See the
  operational review's Nelson evidence; do not silently treat old cached results
  as validated merely because individual real-candidate totals match XML.
- Separate count status from forecast availability and output. Rename `complete`
  to something unambiguous where appropriate. Correct inconsistent documentation
  and public copy in the same PR as the contract change.
- Record compressed raw source payloads/validators and observed arrival times for
  replay under a documented storage budget. Snapshot storage currently omits some
  facts needed to reproduce the model. Archive important data before retention
  prunes it; do not require production secrets in fixtures.
- Freeze model/config versions and their as-of times. Replay with only knowledge
  available at each checkpoint; keep a separate hindsight evaluation if useful.
- Evaluate candidate outcomes, ordinary-count survival and final-seat outcomes
  separately. Include close, Māori, redistributed and multi-candidate contests;
  reliability bins, Brier/log loss, interval coverage and call withdrawals.
  Compare with simpler baselines and account for within-seat correlated checkpoints.
- Obtain a focused statistical review of specials' random variable, covariance,
  multi-candidate allocation and confidence language. A general stats library cannot
  choose the right generative assumptions; jstat already supplies the CDF.
- Do not narrow the specials spread just because the retrospective sd is lower,
  and do not promise no wrong 90% calls: a calibrated 90% claim allows losses.
  If final-seat calibration is inadequate, publish count facts and clearly labelled
  scenario/lead-survival information instead of an authoritative “Win chance”.

**Acceptance:** deterministic offline replay with versioned fixtures, no future
information leakage, explicit official-result tests, probability sums/invariants,
completion-transition and three-way tests, and a checked-in evaluation report.
Treat the current validation as supporting evidence, not proof of calibration.

## R8 — Buy interaction behaviour; keep the design system

**Answer to “did we reinvent the wheel?”: yes for some behaviour, not for the
whole UI.** The custom count band, worked examples, electorate map, chamber and
editorial tables are meaningful product code. A large themed component suite
would not remove most of that and could add styling overrides and bundle weight.

The strongest examples of replaceable machinery are:

- `WinPercentDrawer.tsx` (150 lines) and `BottomSheet.tsx` (71): separate portal,
  Escape, overlay and body-scroll implementations. The drawer moves/restores
  focus but neither implements modal focus containment/background inertness;
  `aria-modal` alone does not supply those behaviours. The sheet can also reference
  a title ID with no rendered title.
- `ElectorateSearch.tsx` (157): home-grown combobox state, arrow-key handling,
  active descendant, blur timeout and mouse-only selection handler. Its filter is
  not the core's macron-insensitive matching. This is exactly the sort of behaviour
  a tested primitive should own.
- `MapControls` repeats outside-click handling; the chamber uses native drag/drop
  and its own keyboard-drag state even though dnd-kit is already used for table rows.
- Floating UI is already used for positioning. Prefer using an existing dependency
  consistently over introducing a second popover position engine casually.

**Implementation brief**

- Recommended default: **React Aria Components**, styled with existing Tailwind
  tokens, for modal/dialog, popover and combobox behaviour. It covers search as
  well as overlays. Do a small drawer+search spike before committing to migration.
- A valid alternative is **Radix primitives** for the overlay/menu family if the
  spike proves a better fit, with an explicit combobox choice. Choose one primary
  interaction family; do not install React Aria, Radix and Headless UI together.
- Keep thin app-owned wrappers under `components/ui/` and retain the current public
  component APIs where useful. Libraries own focus, keyboard, dismissal, portal
  and scroll behaviour; wrappers own Newsprint styling and product composition.
- `shadcn-compatible` CSS variables are not evidence that shadcn components are
  installed. shadcn is primarily a source-distribution approach: copied components
  still become maintained application code. It can supply useful wrappers, but
  copying a catalogue is not a guaranteed code reduction.
- Preserve multiple-trigger focus return, mobile full-width drawer, safe-area
  padding, portal stacking over Leaflet, reduced motion, theme and route behaviour.
  Note `components/ui/**` is currently ignored by ESLint: do not hide new maintained
  wrappers from lint merely because of that folder name.
- For the chamber, first consider whether reordering needs both seat-grid and table
  affordances. If both remain, reuse existing dnd-kit sensors/announcements rather
  than maintaining another touch/keyboard drag implementation. Geometry remains
  custom; test spatial navigation rather than assuming a generic sortable list fits.
- Keep ordinary `<table>`, button and native input markup where it is sufficient.
  TanStack Table is conditional on demonstrable repeated sorting/filter/pagination
  machinery, not a default replacement for every four-column table. It does not
  solve sticky/pinned CSS or editorial cell composition.
- Recharts already owns most charts. Compare CountedTape against a shared Recharts
  step-series wrapper; retain its custom SVG if the receipt rug, keyboard readout
  and layout require as much code in library customisations. Do not force a rewrite
  solely to make the dependency list look uniform.

**Acceptance and adoption gate**

- Keyboard-only Tab/Shift-Tab cannot escape a modal; Escape dismisses only the
  topmost overlay; focus returns to the actual trigger; background interaction is
  blocked; nested overlays close/restore scroll correctly.
- Search works with keyboard, pointer, touch, macrons, empty results and scrolling
  the active option into view. Include browser-level accessibility checks and a
  screen-reader smoke test; jsdom cannot establish layout/focus/scroll correctness.
- Capture real DOM screenshots at 360/390px and desktop, light/dark, reduced motion,
  map-plus-overlay and scrolling-table states. A dev/test browser is appropriate;
  do not put one in the collector.
- Record application behaviour code deleted, wrapper code added, direct/transitive
  dependency changes and production bundle delta. The three files above total
  378 lines including comments/JSX, **not** 378 lines of guaranteed savings.
  The goal is less behaviour owned and fewer accessibility defects, not lowest LOC.

## R9 — Backend libraries: targeted consolidation, not framework replacement first

| Area                | Decision                                        | Why / replacement boundary                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime schemas     | Use existing Zod more fully                     | Define shared result/history/status envelopes; infer TS types instead of parallel unchecked casts. Validate source-normalised data, socket input and HTTP boundaries, not repeatedly inside pure reducers. Preserve unknown versus zero and reject non-finite/negative/impossible counts.                                  |
| Routing             | Conditional Hono adoption                       | Replace manual route regexes, URL decoding, response/error plumbing and method checks with a small router, keeping node:http/Socket.IO and existing service modules. Compare one vertical slice against existing code; Fastify is a reasonable alternative if its schema/plugins are actually needed, but do not add both. |
| HTTP retries        | Keep native fetch; consider p-retry             | Explicit per-attempt and total deadlines, cancellation, bounded attempts, Retry-After policy and retryable statuses. The current 41-line helper retries every non-2xx and has no deadline. A dependency is worthwhile only if it replaces this policy machinery, not for line count alone.                                 |
| Concurrency         | Prefer existing helper unless requirements grow | `mapSettledWithConcurrency` encodes ordered settled results needed for partial-seat fallback. p-limit/p-map are options, but deleting a small correct helper for an adapter is not inherently simpler. Bound webhook fan-out independently.                                                                                |
| Persistence         | Keep SQLite + Drizzle                           | Reuse prepared statements/batching and optimise measured queries; move execution to a worker. A different ORM does not fix a blocked event loop, and a bigger database is not the first fix for N+1 reads.                                                                                                                 |
| Cache               | Small explicit policy; optional lru-cache       | A cache library can bound entries and TTL, but cannot decide stale semantics, revision lag or readiness. Use one if it removes real lifecycle machinery; do not add Redis for a single-machine response cache.                                                                                                             |
| Transport           | Use more of Socket.IO                           | Ack/timeouts/reconnect already exist in the dependency. A custom ten-payload queue does not supply durable state replication. No Kafka/NATS/BullMQ requirement for this workload.                                                                                                                                          |
| Numerical functions | Keep jstat                                      | The main uncertainty is model assumptions/calibration, not implementing a normal CDF. A larger numerical library will not validate the model.                                                                                                                                                                              |

**Concrete protocol issues to fix, even without a router:**

- `server/api.ts` ignores request method. The collector parses/decodes some routes
  outside its query error boundary and uses async handlers without a common error
  response path. Invalid URL encoding, invalid params and dependency rejection
  should produce bounded JSON errors, not an unhandled handler rejection.
- Collector `?year=` support is not exposed consistently by the dashboard proxy.
  Either formally support it end-to-end with year-keyed caches, or reject it;
  do not imply a filter was honoured when it was ignored.
- Typed `payload: ResultsPayload` on a socket callback does not validate network
  input. Loopback filtering is an access policy, not a schema check. For any split
  deployment, authenticate the publisher explicitly; `ALLOW_REMOTE_RESULTS` should
  not mean any remote visitor can publish.
- Extract bootstrapping from service construction so tests can inject source,
  clock, persistence and transport without importing a module that starts servers.
  Prefer these small seams to a generic pipeline framework or dependency-injection
  container.

**Go/no-go gate:** migrate one history route end-to-end, preserving metrics route
labels, static/SPA fallback, status codes, URL encoding, cancellation and Socket.IO
upgrade handling. Keep the router only if it deletes duplicated protocol code and
improves error/contract tests. Do not spend P0 time moving unchanged handlers into
a framework. Check Node/ESM/native dependency support and production audit before
adding packages; pin through the lockfile.

## Incident investigation and release checklist

### Establish what actually happened last night

For each reported interval, collect deployed SHA/config, UTC/NZ-time interval,
affected page, whether reload helped, collector cycle outcomes, source validators,
snapshot-write outcomes/latency, disk/WAL/free space, dashboard receive logs,
history upstream `stale_served`, and latest persisted snapshot time/revision.

| Observation                                                     | First path to investigate                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Open chart stays old; reload immediately fixes it               | R2 historical one-shot query or remaining failed/stale refetch recovery |
| Proxy history old, collector history newer                      | R3 fallback/cache or timeout                                            |
| Source fetch newer; DB old; later 304s look healthy             | R1 validator/body mismatch; DB failure                                  |
| Collector DB new; current tables old/incomplete after restart   | R4 delivery/latest-state recovery                                       |
| Many history/metrics timeouts around write/sweep                | R6 event-loop/query contention                                          |
| Counts match but “remaining”/percentage differs from Commission | R5 denominator/provenance; R7 lifecycle                                 |

Fetching continuing is not evidence persistence, notification or browser refresh
continued. A new source `Last-Modified` without changed vote facts is also not
evidence another history point should exist. Preserve the evidence before retries,
retention or redeployment erase it. Do not reset the production volume to diagnose
stale history.

### Cross-layer acceptance suite

Extend the existing mock/pipeline suite rather than building another simulator:

1. Start at zero; progress through unequal early/mid/late/full stages; keep a
   browser history view mounted throughout; verify its last committed revision.
2. Exercise all-304 healthy silence, partial seat failures and mixed-age results.
3. Inject DB failure after a successful baseline, cache failure after commit,
   disconnect during send, ack loss, dashboard-only restart and collector restart.
4. Simulate slow history reads, upstream outage, retained stale data and recovery.
5. Transition preliminary -> specials/official result, including a correction that
   reduces votes. Do not impose monotonic votes/progress where corrections can occur.
6. Repeat with 24h retained fixture and a retention sweep under load; reconcile
   revisions at fetch/commit/accept/serve/browser boundaries.

Roll out with migrations backed up, a feature flag where contracts change, old/new
read compatibility during deployment and rollback instructions. Declare freshness
SLOs against completed collector commits: an active browser should normally show
the latest committed history within 30s; notifications should usually be faster.
Source-to-browser latency also includes collection duration plus the configured
poll delay, so a “60s poll” is not a hard 60s source-freshness guarantee.

### Verification performed for this review

- `npm run build:core` passed.
- Nine relevant Vitest files passed: **120 tests** covering useApi, socket-triggered
  history refresh, history proxy/server, seat probability, dashboard count helpers,
  Win % drawer, collector watchdog and unchanged-cycle behaviour. These passing
  tests do not cover all gaps above.
- Read-only/ad-hoc local probes reproduced the validator/body mismatch and the
  national-100%-with-an-unreported-electorate case. Temporary probe data was removed;
  application source was not modified. These should become permanent regression
  tests in the implementing PRs.
- Full lint/typecheck/test suite, production benchmarks and browser/accessibility
  tests were not run as part of this documentation-only review.

## Library capability references

Consulted during review; implement against the versions actually selected rather
than assuming every latest-doc API exists in an installed version.

- [TanStack Query defaults and polling distinction](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [React Aria ComboBox](https://react-aria.adobe.com/ComboBox)
- [Radix Dialog: focus trapping, modal behaviour and keyboard interactions](https://www.radix-ui.com/primitives/docs/components/dialog)
- [Socket.IO delivery guarantees and acknowledgement retries](https://socket.io/docs/v4/delivery-guarantees/)
- [p-retry: retry policy and cancellation](https://github.com/sindresorhus/p-retry)
- [Hono validation and Zod integration](https://hono.dev/docs/guides/validation)
