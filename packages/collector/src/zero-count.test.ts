import { afterEach, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The published-but-not-yet-counted feed is the ballot, not a result.
 *
 * Since the 2026 media feed publishes every electorate with zero votes well
 * before election night, a collector that records those scrapes fills the
 * timeline with flat zero snapshots and — because the results cache doubles as
 * the diff baseline — makes the first real count at 7pm look like a leader
 * change in every seat. The scrape must still publish (the dashboard wants the
 * candidate list) but stay out of history, the caches and the feed.
 */

const children: ChildProcess[] = [];
const servers: Server[] = [];
let dir: string | null = null;

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

async function freePort(): Promise<number> {
  const probe = createSocketServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const REFERENCE: Record<string, string> = {
  'candidates.xml': `<?xml version="1.0" encoding="UTF-8"?>
<candidates>
  <candidate c_no="1">
    <candidate_name>ALICE, Alison</candidate_name>
    <electorate>1</electorate>
    <party>10</party>
    <list_no>1</list_no>
  </candidate>
  <candidate c_no="2">
    <candidate_name>BOB, Robert</candidate_name>
    <electorate>1</electorate>
    <party>11</party>
    <list_no>1</list_no>
  </candidate>
</candidates>`,
  'parties.xml': `<?xml version="1.0" encoding="UTF-8"?>
<parties>
  <party p_no="10">
    <abbrev>RED</abbrev>
    <short_name>Red Party</short_name>
    <party_name>Red Party</party_name>
    <registered>yes</registered>
  </party>
  <party p_no="11">
    <abbrev>BLU</abbrev>
    <short_name>Blue Party</short_name>
    <party_name>Blue Party</party_name>
    <registered>yes</registered>
  </party>
</parties>`,
  'electorates.xml': `<?xml version="1.0" encoding="UTF-8"?>
<electorates>
  <electorate e_no="1">
    <electorate_name>Auckland Central</electorate_name>
  </electorate>
</electorates>`,
  'e01/e01.xml': `<?xml version="1.0" encoding="UTF-8"?>
<electorate e_no="1" final="true" updated="2026-10-22T15:19:30">
  <statistics>
    <total_voting_places>0</total_voting_places>
    <total_voting_places_counted>0</total_voting_places_counted>
    <percent_voting_places_counted>0.0</percent_voting_places_counted>
    <total_votes_cast>0</total_votes_cast>
    <percent_votes_cast>0.0</percent_votes_cast>
    <total_party_informals>0</total_party_informals>
    <total_candidate_informals>0</total_candidate_informals>
  </statistics>
  <partyvotes>
    <party p_no="10"><votes>0</votes></party>
    <party p_no="11"><votes>0</votes></party>
  </partyvotes>
  <candidatevotes>
    <candidate c_no="1"><votes>0</votes></candidate>
    <candidate c_no="2"><votes>0</votes></candidate>
  </candidatevotes>
</electorate>`,
};

async function waitForHealth(
  port: number,
  timeoutMs = 30_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`/health did not answer on :${port} within ${timeoutMs}ms`);
}

describe('collector against a published but uncounted feed', () => {
  test('publishes the ballot without recording a snapshot or a feed baseline', async () => {
    const feed = createServer((req, res) => {
      const path = (req.url ?? '/').replace(/^\/+/, '').replace(/\?.*$/, '');
      const body = REFERENCE[path];
      if (!body) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(body);
    });
    servers.push(feed);
    feed.listen(0, '127.0.0.1');
    await once(feed, 'listening');
    const feedPort = (feed.address() as { port: number }).port;

    const healthPort = await freePort();
    dir = mkdtempSync(join(tmpdir(), 'collector-zerocount-'));

    let stderr = '';
    const child = spawn('npx', ['tsx', 'packages/collector/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTION_YEAR: '2026',
        XML_FEED_BASE_URL: `http://127.0.0.1:${feedPort}/`,
        DB_PATH: join(dir, 'election_results.db'),
        RESULTS_CACHE_PATH: join(dir, 'electorate_results.json'),
        HEALTH_PORT: String(healthPort),
        WS_URL: 'ws://127.0.0.1:1',
        POLL_INTERVAL_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const health = await waitForHealth(healthPort);
    expect(health.lastError, stderr).toBeNull();

    // Wait for more than one poll so a repeat is not confused with a first run.
    await new Promise((r) => setTimeout(r, 2000));
    const later = await waitForHealth(healthPort);
    expect(later.lastCycleOk).toBe(true);
    expect(later.lastVotesCounted).toBe(0);
    expect(Number(later.cycleCount)).toBeGreaterThan(1);

    const snapshots = await fetch(
      `http://127.0.0.1:${healthPort}/history/snapshots`
    ).then((r) => r.json());
    expect(snapshots).toEqual([]);
  }, 60_000);
});
