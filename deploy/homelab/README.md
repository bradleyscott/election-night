# Homelab collector — Coolify on Proxmox LXC

Deploys **only the collector** (scraper) to a Proxmox LXC using [Coolify](https://coolify.io)
as a self-hosted PaaS, giving a `fly deploy`-like workflow: push to GitHub →
auto-deploy → logs/rollbacks in a web UI.

The dashboard server stays in the cloud. The collector publishes results to it
over Socket.io (`WS_URL`), so in the default setup the homelab needs **no
inbound ports and no router changes at all** — everything the collector does
(scraping, socket publishing, optional webhooks) is outbound.

```
[GitHub push] ──► [Coolify on LXC] ── builds Dockerfile.collector ──► [collector container]
                                                                          │ scrapes electionresults.govt.nz (residential IP)
                                                                          ▼
                                              Socket.io (outbound, wss) ──► [cloud dashboard server]
```

---

## 1. Create the Proxmox container

- Template: **Debian 12** (from the Proxmox template store).
- **Resources:** 4 GB RAM / 2 vCPU / 32 GB disk. The LXC runs Coolify's own
  stack (app + Postgres + Redis + proxy) *and* the collector's stealth Chromium,
  which spikes memory during a scrape.
- **Networking:** bridge `vmbr0`, static IP or a DHCP reservation on your
  router. Note the IP for later.
- **Features (if unprivileged — recommended):** enable `nesting=1` and
  `keyctl=1`. Docker inside LXC requires them. If you hit permission quirks,
  a small Debian *VM* is the boring-reliable fallback (Proxmox treats both the
  same; a VM sidesteps LXC+Docker edge cases entirely).

## 2. Install Docker + Coolify

```bash
curl -fsSL https://get.docker.com | sh
curl -fsSL https://coolify.io/install | bash
```

Coolify's UI is at `http://<lxc-ip>:8000`. Finish the onboarding (create an
admin account; it generates an SSH key and adds `localhost` as the server).

## 3. Add the application

1. **New → Application → GitHub App** (or webhook-only, if you don't want to
   install the Coolify GitHub App).
2. Pick this repo (`election-night`).
3. Build pack: **Dockerfile** · Base directory: `/` · Dockerfile location:
   `Dockerfile.collector`
4. Leave **Ports** empty — the collector is outbound-only (see §6 for when
   that changes).

## 4. Environment variables

Paste the values from [`.env.collector.example`](.env.collector.example) into
the application's **Environment Variables** tab. The ones that matter on the
homelab:

| Variable | Value / note |
|---|---|
| `WS_URL` | `https://<your-cloud-app>.fly.dev` — where the collector publishes to |
| `BASE_RESULTS_URL` | the real election results site (default in config if unset) |
| `SOCKET_TOKEN` | shared secret — set the **same value** in the cloud server's `fly.toml` |
| `CLOAKBROWSER_HEADLESS` | `true` on a headless LXC |
| `CLOAKBROWSER_PROXY` | only if the home connection itself gets WAF-blocked |

Coolify injects these as container env vars. `dotenv` never overrides
already-set env vars, so no `.env` file is needed (and none should be shipped —
`.dockerignore` excludes it).

## 5. Persistent storage

Add two **Storages** (persistent volumes) to the application:

| Volume (Coolify) | Mount path | Why |
|---|---|---|
| `collector-data` | `/app/.data` | SQLite DB + JSON caches survive redeploys |
| `collector-browser` | `/app/.cloakbrowser` | stealth Chromium binary survives redeploys |

## 6. Deploy & verify

Hit **Deploy**. In the Logs tab you should see, in order:

```
Scraper Configuration ...            # env echo
Connected to socket.io server at ... # WS_URL reachable
Electorates: 72                      # source adapter loaded
...per-electorate fetch lines...
Processing of results completed!     # first cycle done
```

Then confirm the cloud dashboard starts updating. Test before the real night
with the mock server: run `npm run start:mock` on the LXC *host*, set
`BASE_RESULTS_URL=http://<lxc-host-ip>:3457` for one deploy, and watch the
dashboard populate.

## 7. Auto-deploy

With the GitHub App connected, every push to `main` redeploys automatically
(disable "Auto Deploy" in the UI if you'd rather deploy manually).

---

## Router & DNS — only when you expose something inbound

**Nothing to do for the collector as-is.** Ports are only needed if you later
serve the history REST endpoint (variant B) or the whole dashboard from home:

1. **CGNAT check first** (make-or-break): compare the router's WAN IP with
   `curl ifconfig.me` from the homelab. If they differ, you're behind ISP NAT
   and port forwarding will never work — use Cloudflare Tunnel (free TLS) for
   inbound instead.
2. **DHCP reservation** for the LXC (never let the forward target change).
3. **Forward `80` and `443` → LXC** — both, because Let's Encrypt's HTTP-01
   challenge needs port 80.
4. **DNS:** `A` record → home WAN IP (or a DDNS hostname).
5. Then, in Coolify: add a **Domain** to the application (its Traefik proxy
   terminates TLS automatically, no Caddy needed) and map the app's port.
6. Hygiene: never forward SSH from the WAN; administer via Proxmox web UI or a
   Tailscale tailnet.

## Caddy?

Not needed with Coolify — its built-in proxy (Traefik) handles domains, TLS,
and WebSocket upgrades. The only time you'd write a Caddyfile is if you run the
collector (or the dashboard server) outside Coolify; for reference, exposing
the history endpoint directly:

```caddyfile
election-night.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:3459   # collector's history REST endpoint
}
```

## Operational notes

- **Backups:** Coolify has built-in backups; Proxmox snapshots of the LXC cover
  the volumes. Snapshots + a restore drill before election night.
- **Logs:** Coolify's UI is the primary view; `docker logs` / `journalctl` on
  the LXC as fallback.
- **Upgrades:** keep Coolify updated via its UI; the collector container is
  stateless apart from the two volumes, so redeploys are safe.
- **Fonts:** cloakbrowser logs `Incomplete Windows font set` on Linux — the
  image ships `fonts-liberation` only. If Cloudflare still challenges you from
  the homelab, install a fuller set (`fonts-noto-cjk` + `ttf-mscorefonts-installer`)
  in the LXC, or silence the warning with `CLOAKBROWSER_SUPPRESS_FONT_WARNING=1`.
- **If the home box dies on election night:** the cloud dashboard keeps serving
  the last published results; only fresh data stops. That's the accepted
  tradeoff for the residential-IP egress.

## Health checks

The collector serves live state at `http://127.0.0.1:3459/health` (JSON: cycle
count, last success, votes counted, socket state, last publish). The Dockerfile
declares a `HEALTHCHECK` that Coolify picks up automatically; optionally mirror
it in the app's Health Check settings (HTTP, path `/health`, port 3459).

Note: an "unhealthy" status does **not** restart the container — Coolify only
de-routes unhealthy apps behind its proxy, which doesn't apply to this
outbound worker. Crash recovery comes from the app's restart policy (default
`unless-stopped`); the healthcheck exists for stall visibility on election
night.

## When the history REST endpoint (variant B) lands

- `EXPOSE 3459` is already enabled — the health server owns the port today;
  variant B extends the same HTTP server.
- In Coolify: add **Port 3459** under Ports and a **Domain**; router forwards
  80/443 → LXC (see above).
- Point the cloud server's `HISTORY_UPSTREAM` at `https://<your-domain>`.
