# Reliability decisions, 8 November 2026

This consolidates the architecture review, the implementation plan, and the
backend and UI spike records into the decisions that still bind the code. The
task-by-task history is in git; the measurements and incident evidence live in
the documents linked at the end.

## What the night exposed

1. A conditional HTTP validator could advance without its body being retained,
   so a later `304` reused a stale result and lost a fetched update.
2. History was read once per page load. A missed socket notification left the
   browser behind with no independent recovery.
3. The history proxy could serve arbitrarily old cached data, and readiness
   could mistake that fallback for a reachable collector.
4. "Votes counted on the night", "votes still out" and "specials still out"
   were presented through overlapping names and changing denominators.
5. The specials parser misaligned a summary column, so its calibration figures
   could not be trusted.

## Decisions in force

### History is a query with an explicit freshness state

- The proxy caches a verified value for **10s** and may serve a failed refresh
  for at most **120s since successful verification**; older than that, or with
  no usable value, is a structured `503`. A stale fallback never advances its
  verification time.
- Mutable history responses are `Cache-Control: no-store` and carry
  `X-Election-History-State`, `-Verified-At`, an optional bounded `-Reason`, and
  the committed `X-Election-Revision`.
- A collector `503` means unavailable, not an empty successful count. A
  verified archive-year `404` is a normal absence and is not cached.
- `/ready` probes the collector's real `/health`. Cached snapshots cannot make a
  failing dependency look healthy; dashboard `/health` stays liveness only.
- In the browser, one TanStack Query client owns history (30s poll while
  visible, 8s per attempt, 30s retry budget, at most two retries). A socket
  result, a reconnect, or focus invalidates the history keys. On startup and
  reconnect the browser bootstraps from `/api/history/latest` and compares
  revisions.

### Latest state is durable, and delivery is revisioned

- Migration `0004` stores one `latest_state` row per cycle: revision,
  publication key, full payload, source/observed time, phase, coverage and
  model/config version. `0005` adds the webhook outbox.
- A publication key is chosen once and reused on retry, so an idempotent retry
  cannot duplicate a snapshot or an announcement. `A → B → A` is a new key and a
  new revision.
- Socket frames carry `{payload, electionYear, revision}` and are acknowledged.
  An equal revision is acked as a duplicate without a second broadcast; an
  older revision or another cycle is rejected. Delivery is at-least-once, not
  exactly-once.
- SQLite is owned by one worker thread. The client allows one request in
  flight, a bounded queue and per-request deadlines; overflow or worker death
  is unavailable, and worker death exits the collector so the supervisor
  restarts it rather than leaving it publishing without recording.

### Webhook delivery is decoupled from the count

`buildWebhookPayloads` builds announcements from the same previous cache the
diff uses, and the snapshot transaction persists them. The outbox loop claims
due rows with a lease, posts with a deadline and bounded concurrency, retries
`429`/`5xx`/network failures with exponential backoff, dead-letters a permanent
`4xx` or an exhausted budget, and prunes delivered rows. A hung receiver cannot
delay the result the dashboard shows. Delivery counts and duration are recorded
on the collector's own metrics registry.

### Facts, estimates and completion have different contracts

`packages/core/src/count-summary.ts` is the single `CountSummary`: counted
facts (feed total, candidate and party sums and their difference), contributing
places and in-seat booths as separate fields, ordinary progress with a nullable
estimate and provenance, a separately labelled specials estimate, and a phase
(`counting` / `preliminary-complete` / `official` / `unknown`).

An official result has no outstanding ordinary or special votes. An
unvalidated `final` flag is not official. A missing estimate prints as
unavailable, never as zero. The sea, the map, closeness surfaces and the seat
band all read the same summary, so none can invent a different denominator.

### Model figures are per cycle, versioned and measured

- Turnout, night share and special share live in `CYCLE_CONSTANTS` per cycle,
  because they differ enough to change `progress`. An unseen cycle inherits the
  newest row flagged `assumed`.
- `scripts/lib/specials-swing.mjs` is the one specials parser. It keeps header
  cells at their original index, so a summary column cannot become a candidate,
  and its parsed caches are versioned with their source URLs.
- Probability is a forecast with a result lifecycle. `computeSeatChance` reports
  `waiting`, `counting` or `complete`; `probability` includes the special vote,
  `countProbability` is the count-only number, and completion does not claim the
  seat is decided.
- No parameter changes without the versioned evaluation report
  (`scripts/validate-seat-probability.mjs --json --out <path>`). The current
  review did not retune the model.

### Bound work before adding infrastructure

History reads use a trailing window, an explicit `?limit=`/`?offset=` page
capped per cycle, an optional `?sinceRevision=` cursor, and grouped queries
(three statements per electorate, three for party history). A window over the
cap is a `413`, never a truncated array. Per-seat place fetches share a
service-wide budget; overflow answers `available: false, reason: "busy"` rather
than pretending every place is outstanding.

### Runtime validation belongs at the boundaries

- Zod parses the socket envelope (or a legacy bare payload) before it can set
  retained state.
- `ALLOW_REMOTE_RESULTS=true` alone does not authorise a remote publisher: it
  also needs a matching `RESULTS_TOKEN`. Loopback is always accepted.
- Declining Hono is recorded, not forgotten: it would replace a small `node:http`
  dispatcher while leaving Socket.IO, the worker client and SPA serving in
  place, so it adds a second routing model without deleting measured protocol
  code. Revisit only with a before/after test and dependency delta on one route.

### Interaction primitives: one family, and not yet React Aria

The Win % drawer owns open/close, Escape, backdrop dismissal, scroll lock and
focus return. The bottom sheet, electorate search and map controls own their
keyboard, safe-area and Leaflet stacking rules, and component tests pin those
behaviours. Adopting React Aria requires migrating both the drawer and the
combobox in one pass; migrating one would leave two overlapping primitive
families. The acceptance matrix (focus containment, background inertness,
nested Escape, scroll restoration, macron search at 360/390px in both themes)
needs a real-browser runner, so the migration is deferred rather than started
without evidence.

## Open work and release limitations

- **The UI primitive migration is deferred** (the previous plan's task 11). The
  current wrappers stay; no new primitive family is shipped. Next step: add
  React Aria behind the existing component props, run the browser matrix, and
  keep it only if it deletes owned focus/keyboard/dismissal/scroll code.
- **2026 constants are preliminary.** They come from the Commission's
  7 November result and are revised at the official count on 27 November.
- **Specials calibration excludes 2026.** The spread was measured on 2017,
  2020 and 2023; treat the 2026 special-vote split as unverified until the
  official result exists.
- **The release rehearsal was offline.** It used the mock feed and the
  fault-injection harness; no live feed, production credentials or Fly rollback
  was exercised. See `docs/release-rehearsal-2026-11-08.md`.
- **A split deployment needs both switches.** Remote publishing requires
  `ALLOW_REMOTE_RESULTS=true` and a matching `RESULTS_TOKEN`.

## Finding ids used by the incident review

The operational review refers to findings by their original ids:

| Id  | Finding                                                                 |
| --- | ----------------------------------------------------------------------- |
| R1  | A validator must stay paired with the body it validates                 |
| R2  | History is an actively maintained query, not a one-shot read            |
| R3  | Freshness and degradation are part of the API                           |
| R4  | One durable latest result, with revisions and recoverable delivery      |
| R5  | Facts, estimates and completion need different contracts                |
| R6  | Bound history work before adding infrastructure                         |
| R7  | Probability is a versioned forecast; parser integrity gates calibration |
| R8  | Buy interaction behaviour, keep the design system                       |
| R9  | Targeted backend consolidation, not framework replacement               |

## Evidence

| Question                                     | Document                              |
| -------------------------------------------- | ------------------------------------- |
| What actually happened on the night          | `election-night-2026-11-07-review.md` |
| History read cost, window and budgets        | `history-load-baseline.md`            |
| Probability evaluation and its stated limits | `model-evaluation-2026-11-08.md`      |
| Rehearsal scenarios and rollback             | `release-rehearsal-2026-11-08.md`     |
| Metrics, dashboards and alerts               | `observability.md`                    |
| Why the model is shaped this way             | `seat-probability-model.md`           |
| Voting-place feed facts and the place model  | `voting-place-data.md`                |
