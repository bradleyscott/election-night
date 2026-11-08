# History read load: baseline, window and budgets

The collector's `/history/*` endpoints are read on the same Node event loop that
writes SQLite, so a read that grows with the retained snapshot count both slows
the chart and blocks the writer. This records the measured baseline, the grouped
replacement, and the bounds that stop one request scanning an unbounded table.

## Workload

`npm run bench:history` seeds a temporary database with the worst case the
production cadence can produce and times the reads the dashboard makes:

- 1,440 snapshots (24h at a 60s poll),
- 71 electorates, 8 candidates and 17 party votes per seat,
- a party summary per party per snapshot,
- one out-of-window snapshot for the retention measurement.

The script keeps the old per-snapshot N+1 next to the grouped path so the two
shapes run against identical rows. The full run is opt-in; the small equivalent
(`src/history-load.test.ts`, 24 snapshots) runs in `npm test` and asserts the
statement count is flat and the grouped result is identical to the old read.

## Result (full run)

```
Seeded 1440 snapshots (71 seats).

| Scenario | Statements | Rows | Bytes | p50 ms | p95 ms | p99 ms | max loop lag ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| grouped · snapshots | 1 | 1440 | 160177 | 1.3 | 2.9 | 2.9 | 3.0 |
| legacy · one electorate | 2881 | 1440 | 1931280 | 48.0 | 51.4 | 51.4 | 51.5 |
| grouped · one electorate | 3 | 1440 | 1931280 | 24.6 | 26.1 | 26.1 | 26.1 |
| grouped · five electorates | 15 | 7200 | 9658561 | 127.1 | 130.2 | 130.2 | 130.2 |
| legacy · party votes | 2883 | 1441 | 2246216 | 45.2 | 50.0 | 50.0 | 50.0 |
| grouped · party votes | 3 | 1440 | 2246058 | 22.3 | 23.0 | 23.0 | 23.0 |
```

`Statements` is per request. The grouped paths issue **3** statements whatever
the window holds: one paged snapshot query plus one child query per collection
(candidates and party votes for a seat; party totals and counted totals for the
national series). The old shape issued `1 + 2N` (2,881 at N=1,440).

Five electorates remain linear in seats (3 statements each); the fixed part is
the point. The synchronous read also blocks the event loop for roughly its own
duration, so halving the query time halves the longest stall the writer sees.

Run it yourself:

```bash
npm run bench:history            # full 1,440-snapshot fixture
npm run bench:history -- --quick # 120 snapshots, for a fast check
npm run bench:history -- --json  # machine-readable output
```

## Index evidence

`npm run bench:history -- --quick --explain` prints `EXPLAIN QUERY PLAN` for
every prepared statement. On the grouped paths:

```
SELECT ... FROM scrape_snapshots ...
  SEARCH scrape_snapshots USING INDEX idx_scrape_snapshots_year_started (election_year=? AND started_at>?)

SELECT ... FROM scrape_snapshots ss JOIN electorate_summary es ...
  SEARCH ss USING INDEX idx_scrape_snapshots_year_started (election_year=? AND started_at>?)
  SEARCH es USING INDEX sqlite_autoindex_electorate_summary_1 (scrape_id=? AND electorate=?)

SELECT ... FROM electorate_results ...
  SEARCH electorate_results USING INDEX idx_electorate_results_seat (electorate=? AND scrape_id=?)

SELECT ... FROM party_vote_results ...
  SEARCH party_vote_results USING INDEX idx_party_vote_results_seat (electorate=? AND scrape_id=?)
```

Migration `0003_tricky_wild_child.sql` therefore adds exactly three indexes:

- `idx_scrape_snapshots_year_started` — the window and its ordering;
- `idx_electorate_results_seat` — the grouped candidate child read;
- `idx_party_vote_results_seat` — the grouped party-vote child read.

A fourth candidate, `electorate_summary(electorate, scrape_id)`, was generated,
measured, and removed: the planner kept driving from the snapshot index (the
`ORDER BY started_at` makes a seat-first plan pay for a temp B-tree), so it was
write cost with no reader. Do not add it back without an `EXPLAIN` that uses it.

## Window and paging

DB-backed history reads are bounded twice:

- **Window.** `HISTORY_WINDOW_HOURS` (default 24, matching `RETENTION_HOURS`)
  limits the read to the trailing window. Old rows on a volume that retention
  has not yet swept cannot re-enter a live chart.
- **Page.** `?limit=` and `?offset=` select a page, capped by
  `HISTORY_MAX_SNAPSHOTS` (default 2,000; a 60s poll yields 1,440 in 24h).
  Responses carry `X-History-Total`, `X-History-Limit`, `X-History-Offset` and
  `X-History-Window-Hours`; the body stays a plain array, so existing clients
  are unchanged.

An unpaged request whose window exceeds the cap is refused with an explicit
`413` naming the total and the cap. Returning the first N rows would make a
chart look complete while silently dropping the rest. A malformed `limit` or
`offset` is a `400`, never coerced to the default.

## Place-fetch budget

`VotingPlaceStatusService` already shared one in-flight request per seat, but ten
visitors opening ten different seats still produced ten independent pools of six
place-file fetches. A service-wide semaphore now caps every place-file fetch:

- `maxActiveFetches = 12` (the plan's starting point),
- `maxQueuedFetches = 64` waiting slots,
- `queueWaitMs = 10s` for a slot.

Each seat holds at most its own `concurrency` (6) fetches at a time, so 64 waiting
slots admit roughly ten seats opening at once behind the 12 running. A larger
queue would not make the feed faster; it would only defer the same limit while
holding more requests open on the machine that also has to scrape.

Overflow or a wait longer than the deadline returns
`available: false, reason: "busy"` — a seat that cannot be answered, not a seat
where every place is reported outstanding (which would read as "nothing has
counted"). The busy answer is not cached, and the smoke tests in
`src/voting-place-status.test.ts` pin the global cap across two seats, the busy
result on overflow, and recovery on the next request.

## Worker ownership (02b)

SQLite no longer runs on the collector's main thread. `src/db-worker.ts` owns the
connection, migrations, writes, reads and retention; `src/db-worker-client.ts`
is the only caller and exposes async methods.

- **Serialisation.** The worker handles one request at a time, so a read cannot
  observe a half-written snapshot and transactions keep their order.
- **Bounded queue.** The client allows one request in flight and 64 waiting.
  Overflow, a request deadline (5s reads, 30s writes, 60s migrations/prune), or
  a dead worker rejects with `DbUnavailableError`. History maps that to an
  explicit 503; it never answers an empty successful count.
- **Serialisable writes.** `writeSnapshot` takes plain data. The old
  `writeResults` callback is evaluated on the caller, which sends
  `progressByElectorate` as numbers — no function crosses the thread boundary.
- **Failure is fatal.** If the worker exits, `onFatal` logs and exits the
  collector so the entrypoint restarts the machine. A collector that keeps
  publishing while recording nothing is the failure the watchdog exists to
  catch.
- **Health stays synchronous.** `/health` is answered on the main thread and
  does not touch the worker. A blocked database job can delay a history response
  (bounded by its deadline) but cannot stop the listener. The test
  `src/db-worker.test.ts` holds a worker request open and fetches `/health`.

`src/clear.ts` and `scripts/benchmark-history.ts` still open the database
directly on purpose: they are standalone tools that run while the collector is
stopped, not part of the serving path.

## What this document does not cover

- The worker ownership described above is the follow-on change; this document
  records the read-shape benchmark that justified the grouped queries before it.
- Durable revisions/latest state and the browser query client/paging consumer
  landed after these measurements. The numbers here are read latency and
  statement counts, not end-to-end socket or browser timings.
- No frontend change was required for the benchmark; the dashboard client now
  follows `X-History-*` paging and treats revision-behind responses as stale.

## Related storage changes

Migration `0004` adds a single `latest_state` row per cycle (full payload plus
its revision) and a nullable revision/model version on snapshots; `0005` adds
`webhook_outbox` with a `(status, next_attempt_at)` due index. None of these
change the read benchmarks above: latest state is one row, and the outbox is
written in the same transaction but read only by the delivery loop. History rows
from before migration 0004 have `revision`/`modelVersion` null and are treated
as legacy rather than reinterpreted.
