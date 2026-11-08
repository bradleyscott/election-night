# Release rehearsal and rollback, 2026-11-08

The offline rehearsal for the reliability work. It uses the mock XML feed and
the fault-injection hooks; no live Commission feed or production credentials
are required.

## Machine and commands

- macOS 27.0.1, arm64, Node v24.16.0.
- `npm run build:core && npm run lint && npm run typecheck && npx vitest run`
- `npm run bench:history -- --quick` (the full 1,440-snapshot run is reported in
  `docs/history-load-baseline.md`).

Last run: **875 tests / 88 files pass**, lint and typecheck clean, production
Vite build succeeds.

## Scenario matrix

| Scenario                                                      | Required observable                                                                                         | Evidence                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source continues; historian HTTP unavailable                  | Live state may advance; history is visibly stale then unavailable; `/ready` does not pass on cached history | `history-upstream.test.ts` (stale window, 503, `stale-too-old`), `api.test.ts` (503/headers), `health.test.ts` (probe fails despite identity)                                          |
| DB write fails after A before caching B; feed then 304s       | B is committed and published without a restart or source change                                             | `validator-retry.test.ts` (A commits, B write fails, source 304-only, B commits; exactly two snapshots)                                                                                |
| Browser misses the final socket notification or a fetch fails | Poll/focus/reconnect catches up without navigation                                                          | `useVoteHistory.test.tsx` (notification, reconnect, failed refresh keeps rows, revision-behind is stale), `SocketProvider.test.tsx`                                                    |
| Many seats plus national history and a write/sweep            | Bounded queries/queues; collector health stays responsive; measured latency                                 | `history-load.test.ts`, `benchmark-history.ts` (1,440 snapshots: electorate read 3 statements/26.1ms p95), `db-worker.test.ts` (health with a blocked request)                         |
| Dashboard-only restart, source unchanged                      | Full state, including parties and lists, recovers                                                           | `db.test.ts` (latest payload has all three collections), `history-server.test.ts` and `api.test.ts` (`/history/latest`), `SocketProvider.test.tsx`                                     |
| Commit succeeds; notification/ack lost                        | Retry/reconciliation converges without duplicate derived events                                             | `ws-client.test.ts` (ack retry, latest-only, resend on connect), `results-envelope.test.ts` (duplicate acked, older rejected), `db.test.ts` (same publication key writes one snapshot) |
| Webhook receiver hangs                                        | Collection and current-result delivery continue; outbox explains failure                                    | `webhook-outbox.test.ts` (hanging receiver times out and retries; `start()` does not wait), `db.test.ts` (outbox inserted in the snapshot transaction)                                 |
| All ordinary places reported; specials pending                | Ordinary count complete; separately labelled specials estimate; stable bar meaning                          | `count-summary.test.ts` (complete below forecast), `ElectorateCountBand.test.tsx` (labels, separate specials measure)                                                                  |
| Official result or unknown phase                              | No fictional outstanding specials or final-result assertion                                                 | `count-summary.test.ts` (official zeroes ordinary/specials estimates; unvalidated `final` is not official)                                                                             |
| Correction reduces a vote count                               | A new ordered revision, not discarded or clamped                                                            | `db.test.ts` (A -> B -> A revisions 1,2,3), `count-summary.test.ts` (downward correction lowers progress)                                                                              |
| Legacy parser cache or summary column                         | Rejected or regenerated; never a candidate/calibration datum                                                | `specials-swing.test.ts` (alignment, versioned cache rejection), `docs/seat-probability-model.md` §4 marked unverified                                                                 |
| Wrong cycle, duplicate or older socket delivery               | Rejected or acked as a duplicate, no second broadcast                                                       | `results-envelope.test.ts`, `pipeline.test.ts`                                                                                                                                         |

## Rollback

1. **App image.** `fly releases` lists prior versions; roll back with
   `fly releases rollback <version>` (or redeploy the previous image). The
   collector and dashboard are one app, so both roll back together.
2. **Database.** Migrations 0003/0004/0005 are additive: indexes, `latest_state`
   and `webhook_outbox`, plus nullable columns. An older image ignores them, so
   an app rollback does **not** need a schema rollback. Do not delete the volume
   or run `npm run clear` as a rollback step; `clear` is for starting a new
   cycle, not for undoing a deploy.
3. Before any destructive schema change (not present in this batch), take a
   volume snapshot with `fly volumes snapshots create <volume-id>`. The election
   night database must never be removed to roll back.
4. **Caches.** The collector's results cache and the dashboard's feed cache are
   replaceable JSON; deleting one only loses the diff/feed baseline until the
   next scrape, not the committed history or latest state.
5. **Feature switches.** `COLLECTOR_ENABLED=false` runs the dashboard alone;
   `COLLECTOR_WATCHDOG=off` disables the liveness restart; remote publishing
   requires both `ALLOW_REMOTE_RESULTS=true` and `RESULTS_TOKEN`.
6. **Verify after rollback:** `/health`, `/ready`, `/history/latest`,
   `/history/snapshots`, a socket connect, and the Seats/Trends pages.

## Not run in this worktree

- Real-browser 360/390px and desktop screenshots (Task 11 is deferred; see
  `docs/ui-primitives-spike-2026-11-08.md`).
- A live Commission feed run. The mock and archive fixtures cover the pipeline.
- A production deployment/rollback. The instructions above are the rehearsal
  document, not a claim that a Fly rollback was executed here.
