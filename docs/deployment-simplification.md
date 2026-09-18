# Deployment Simplification: Retiring the Split Collector

> **STATUS: IMPLEMENTED (Option A).** The collector and dashboard now ship as one image (`Dockerfile.app`) and run together from `docker/entrypoint.sh`; `fly.toml` mounts a `/data` volume and wires loopback `WS_URL`/`HISTORY_UPSTREAM`. PR previews use `fly.preview.toml` (no volume, `COLLECTOR_ENABLED=false`). The Docker image build itself is unverified (no Docker daemon available at implementation time).

## Why the collector was split

The collector was deployed separately from the dashboard because the HTML
scraping path needed **residential egress**. Cloudflare IP-scores the dynamic
`electorate-details-*.html` pages, and datacenter/cloud IPs are blocked or
challenged. The dashboard server had no such requirement, so it lived on Fly.io
while the collector ran wherever it could get an acceptable IP (a home
connection or a paid residential proxy).

## The constraint is gone

The XML feed is a **cached static asset**, not a dynamic protected page. Same
host, same Cloudflare front, very different treatment:

```text
XML:  /electionresults_2023/xml/e01/e01.xml
  HTTP/2 200
  content-type: application/xml
  cf-cache-status: HIT
  cache-control: public, max-age=30
  age: 27

HTML: /electionresults_2023/electorate-details-01.html
  HTTP/2 403
  cache-control: private, max-age=0, no-store
```

Verified with a multi-location datacenter HTTP checker
([report](https://check-host.net/check-report/4c1738fdk11b)), six nodes across
Canada, Indonesia, Israel, Italy, Netherlands, and Portugal — all datacenter
ASNs:

| Target       | Result                                        |
| ------------ | --------------------------------------------- |
| **XML feed** | **6/6 nodes → HTTP 200**                      |
| HTML page    | 2/6 nodes → 200, **4/6 → HTTP 403 Forbidden** |

The HTML path is a lottery that depends on the exit IP's reputation. The XML
feed is served uniformly from the Cloudflare edge cache. A second confirmation:
Jina's cloud reader fetched the XML and returned 200.

**Conclusion:** the collector no longer needs residential egress, a proxy, or a
separate host. It can run anywhere — including on the same machine as the
dashboard.

## Current topology

```text
┌─ Fly.io (app: election-night) ─┐        ┌─ elsewhere (residential IP) ─┐
│  dashboard server              │        │  collector                   │
│  - Socket.io server :3456      │◀───────│  - Socket.io client (WS_URL) │
│  - serves SPA                  │  results│  - SQLite owner              │
│  - /health /ready /metrics     │        │  - /history/* REST :3459     │
│  - history client              │◀───────│  - cloakbrowser + Chromium   │
│  - no SQLite                   │ history │                              │
└────────────────────────────────┘        └──────────────────────────────┘
```

Costs and complexity this creates:

- Two deployments, two images, two runbooks.
- Two network protocols between them: Socket.io (`WS_URL`) + an HTTP history API
  (`HISTORY_UPSTREAM`), both needing auth/exposure decisions.
- A public (or reverse-proxied) collector history endpoint with per-IP rate
  limiting to avoid abuse.
- A residential connection or paid proxy, plus Cloudflare/proxy tuning.
- A heavyweight collector image (Chromium + ~20 system libraries).

With the HTML path gone, **all of the above is removable.**

## Options

### Option A — One Fly app, one machine, two processes (low risk)

Run both the dashboard server and the collector in a single image/VM, connected
over loopback.

```text
┌─ Fly.io (app: election-night, 1 machine, volume /data) ─┐
│  entrypoint                                             │
│   ├─ dashboard server  :3456 (public)                   │
│   └─ collector         :3459 (loopback only)            │
│  WS_URL=ws://127.0.0.1:3456                             │
│  HISTORY_UPSTREAM=http://127.0.0.1:3459                 │
│  DB_PATH=/data/election_results.db                      │
└─────────────────────────────────────────────────────────┘
```

- **Gains:** one app, one deploy, one volume; no public collector; no
  residential IP/proxy; no external network hops.
- **Costs:** a supervisor to run two processes; health checks must cover both;
  a collector crash can be masked unless the supervisor/health check catches it.
- **Code impact:** small. Reuse `Dockerfile.collector`'s build for the collector,
  merge into one image, add an entrypoint script.

### Option B — One process (maximum simplification)

Embed the collector loop in the dashboard server process.

```text
┌─ Fly.io (app: election-night, 1 machine, volume /data) ─┐
│  dashboard server (single Node process)                 │
│   ├─ scrape loop (in-process)                           │
│   ├─ SQLite (in-process)                                │
│   ├─ history (in-process function, no HTTP)             │
│   └─ Socket.io broadcast (in-process event, no client)  │
└─────────────────────────────────────────────────────────┘
```

- **Gains:** everything in Option A, plus no Socket.io client/server split, no
  `/history/*` HTTP API, no `HISTORY_UPSTREAM`, no `WS_URL`, no supervisor, one
  PID, one health surface.
- **Costs:** larger refactor; couples the packages; a collector crash takes down
  the dashboard unless the loop is defensively isolated.
- **Deletes:** `packages/collector/src/ws-client.ts`,
  `packages/collector/src/history-server.ts`,
  `packages/dashboard/server/history-upstream.ts`, the `socket.io` and
  `socket.io-client` dependencies, and the `WS_*` / `HISTORY_UPSTREAM` config.
  The `HistorySource` interface stays, but gains an in-process DB-backed
  implementation.
- **Mitigation for coupling:** keep the collector package standalone-runnable for
  local dev and other elections by exporting `startCollector()` from a module
  that both the CLI entrypoint and the server call.

### Option C — Two apps on Fly, private networking (minimal change)

Keep the split, but deploy the collector to Fly too and talk over
`<app>.internal` private networking instead of the public internet.

- **Gains:** no residential IP; no public history endpoint.
- **Costs:** still two deployments and two images; still two machines; still the
  Socket.io + HTTP history protocol. This is the least simplification and is
  only worth it if you specifically want independent lifecycles.

## Recommendation — CHOSEN: Option A

**DECISION: Option A.** One Fly app, one machine, two processes (collector +
dashboard server) connected over loopback, one volume mounted at `/data`.
Option B is recorded as a possible future simplification but is not in scope.

Rationale: Option A removes the actual constraint (residential egress) and the
public collector surface with minimal code change, and it is trivially
reversible. Option B is the genuinely "simple" end state and deletes ~3 modules
and 2 dependencies, but it changes the architectural contract (the dashboard
server currently never opens a DB), so it deserves its own change.

Option A is the target. It removes the residential-egress constraint and the
public collector surface with minimal code change, and stays reversible.

## New considerations introduced by co-location

| Topic                             | Detail                                                                                                                                                       | Action                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **SQLite persistence**            | Fly machines are ephemeral; a redeploy wipes the disk. The collector's history (snapshots, feed events) is cumulative and must survive restarts and deploys. | Create a Fly volume (`/data`) and point `DB_PATH`, `RESULTS_CACHE_PATH`, `CACHE_PATH`, `FEED_CACHE_PATH` at it.                            |
| **Single-machine, single-volume** | A Fly volume attaches to one machine. Do not scale to multiple machines without LiteFS/Postgres.                                                             | Keep `min_machines_running = 1`, `ha = false` (or accept a brief restart window).                                                          |
| **Memory**                        | Currently 256 MB. Collector is now tiny (no Chromium), but adding it to the dashboard process/machine warrants headroom.                                     | Bump to 512 MB. Cost impact is minor.                                                                                                      |
| **Previews**                      | `preview.yml` deploys one app per PR. Those preview machines would run a live collector and poll the real feed.                                              | Gate the collector behind an env flag (e.g. `COLLECTOR_ENABLED`) and set it `false` in previews, or point previews at the mock XML server. |
| **Health**                        | `/health` currently reflects the dashboard. With a co-located collector, `/ready` should also verify the collector has completed a recent cycle.             | Surface collector state via the existing `health` object / `/ready`.                                                                       |
| **Secrets**                       | No more `CLOAKBROWSER_PROXY`.                                                                                                                                | Remove proxy secrets and the proxy cost.                                                                                                   |
| **Polling rate**                  | The XML feed is cacheable (`max-age=30`). Polling faster than 30s mostly hits Cloudflare cache; consider `POLL_INTERVAL_MS=30000` on election night.         | Update docs/`.env.example`.                                                                                                                |
| **Region**                        | Feed is edge-cached worldwide; any region works. `syd` (current) is a good default for NZ.                                                                   | No change.                                                                                                                                 |

## What simplifies in each layer

**Deployment**

- Two Dockerfiles → one; one app; one machine; one volume.
- `Dockerfile.collector` loses `cloakbrowser install`, the Chromium apt block,
  and `COPY csv/`.
- One `fly.toml`; CI deploys one app (already the case).

**Config**

- Delete: `WS_URL`, `WS_PORT` (collector side), `WS_RECONNECT_DELAY_MS`,
  `HISTORY_UPSTREAM`, `CLOAKBROWSER_PROXY`, plus the HTML/challenge vars from
  the scraper removal plan.
- Add: `COLLECTOR_ENABLED` (for previews).

**Code (Option B only)**

- Delete `ws-client.ts`, `history-server.ts`, `history-upstream.ts`.
- Replace the history HTTP client with an in-process DB-backed `HistorySource`.
- Replace `publishResults()` Socket.io emit with an in-process subscriber call.
- Drop `socket.io` / `socket.io-client` dependencies.

**Docs / runbook**

- README: replace the two-host architecture diagram with the single-app one;
  delete the residential-IP/proxy/Cloudflare guidance.
- AGENTS.md: update the deployment section, the split rationale, and the env
  var list.
- Remove the "collector runs wherever it has suitable egress" wording.

## Suggested sequencing

1. Land the XML-only collector (see `docs/removing-html-scraper-plan.md`).
2. Confirm one real election-night-style cycle from a datacenter IP.
3. **Option A:** merge images, add an entrypoint supervisor, add the Fly volume,
   set loopback `WS_URL` / `HISTORY_UPSTREAM`, gate the collector for previews.
4. **Option B (optional):** collapse to one process and delete the Socket.io +
   history HTTP plumbing.
5. Update docs, delete the residential/proxy runbook, and remove the proxy
   secret.

## Caveats / things to verify before committing

- **Election-night origin behaviour.** The 6/6 datacenter result was measured
  post-election, when the XML is static and cacheable. During live counting the
  files update every ~10s; if Cloudflare origin-fetches more often, protection
  _could_ differ. Mitigate by polling no faster than the cache TTL and by
  keeping the collector able to run on a residential host as a fallback.
- **Media feed vs results feed.** The live/preliminary media feed
  (`media.election.net.nz`) is a different host and may be more protected than
  the results-site XML directory. This analysis covers
  `electionresults.govt.nz/electionresults_{YEAR}/xml/`.
- **Cloudflare policy changes.** Bot rules can change without notice. The XML
  path is low-risk, but keep `/health` alerting on repeated fetch failures so a
  policy change is visible immediately.
