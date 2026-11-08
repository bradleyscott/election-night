# Backend consolidation, 2026-11-08

Task 12 is conditional: use Zod at runtime boundaries, fix method/parameter/
error handling and publisher authentication, then spike Hono on one history
route and keep it only if it deletes protocol code. This records what was done
and the spike decision.

## Done

- **Zod at the socket boundary.** `packages/dashboard/server/validation.ts`
  parses a revisioned envelope or a legacy bare payload. Unknown fields are
  preserved; malformed frames are rejected before they can set the retained
  state.
- **Year and paging validation.** The collector's history handler rejects a
  `?year=` that is not four digits (`400`), and keeps the existing explicit
  `limit`/`offset`/`sinceRevision` validation. Non-GET history requests are
  already `405`.
- **Remote publisher authentication.** `ALLOW_REMOTE_RESULTS=true` no longer
  grants access by itself. A remote publisher must also present a matching
  `RESULTS_TOKEN` in the Socket.IO handshake `auth.token`; without a configured
  token, remote publishers are rejected. Loopback is always allowed. The
  reasons are counted in `election_results_updates_rejected_total`.
- **Hono spike: do not adopt.** The history routes are split into `api.ts`,
  `health.ts`, `static.ts` and `feed.ts`; their status/headers, metrics route
  labels, SPA fallback and cancellation behavior are covered by tests. Hono
  would replace a small `node:http` dispatcher while leaving Socket.IO,
  the worker client and the SPA server in place, so it would add a framework and
  a second routing model without deleting a measured amount of protocol code.
  Revisit only with a before/after test and dependency delta on one route.
- **Retry helper: keep.** `fetchWithRetry` encodes the bounded attempt/delay
  policy used by the conditional feed and the webhook outbox. Replacing it with
  `p-retry` alone would not remove behavior; the outbox already owns its
  deadline/budget/lease policy.
- **Types from schemas.** The socket schema derives its TypeScript shape from
  the core types; the full app is not rewritten to inferred types.

## Tests

- `server/validation.test.ts` — envelope, legacy payload, malformed frames.
- `server/publisher.test.ts` — loopback, remote flag, missing/matching token.
- `collector/src/history-server.test.ts` — malformed year, paging, methods.
- `server/results-envelope.test.ts` — duplicate/older/wrong-cycle decisions.

## Deferred

- Hono on a live route (decision: no).
- Migrating every history route to Zod schemas (the paging code already has
  explicit bounds; a schema wrapper would not add coverage without a route
  refactor).
- Production dependency audit is part of the release gate (Task 13).
