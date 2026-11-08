import { afterEach, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A poll that finds nothing new must write nothing.
 *
 * The collector polls every minute, and the feed is quiet for most of a day. A
 * cycle where every seat answers `304 Not Modified` describes the payload that
 * was already published, so it must add no snapshot row and broadcast nothing —
 * while a cycle that *failed* to publish must be retried on the next one, even
 * though the feed still says nothing has changed.
 */

const children: ChildProcess[] = [];
const servers: Server[] = [];

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
});

async function freePort(): Promise<number> {
  const probe = createSocketServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const FEED: Record<string, string> = {
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
<electorate e_no="1" final="false" updated="2026-11-06T19:00:00">
  <statistics>
    <total_voting_places>10</total_voting_places>
    <total_voting_places_counted>6</total_voting_places_counted>
    <percent_voting_places_counted>60.0</percent_voting_places_counted>
    <total_votes_cast>1000</total_votes_cast>
    <percent_votes_cast>10.0</percent_votes_cast>
  </statistics>
  <partyvotes>
    <party p_no="10"><votes>700</votes></party>
    <party p_no="11"><votes>300</votes></party>
  </partyvotes>
  <candidatevotes>
    <candidate c_no="1"><votes>700</votes></candidate>
    <candidate c_no="2"><votes>300</votes></candidate>
  </candidatevotes>
</electorate>`,
  'election.xml': `<?xml version="1.0" encoding="UTF-8"?>
<election updated="2026-11-06T19:00:00">
  <statistics>
    <total_votes_cast>1000</total_votes_cast>
    <percent_votes_cast>10.0</percent_votes_cast>
    <total_electorates_final>1</total_electorates_final>
    <percent_electorates_final>100.00</percent_electorates_final>
  </statistics>
  <partystatus>
    <party p_no="10">
      <votes>700</votes><percent_votes>70</percent_votes>
      <party_seats>1</party_seats><candidate_seats>1</candidate_seats><total_seats>1</total_seats>
    </party>
    <party p_no="11">
      <votes>300</votes><percent_votes>30</percent_votes>
      <party_seats>0</party_seats><candidate_seats>0</candidate_seats><total_seats>0</total_seats>
    </party>
  </partystatus>
</election>`,
};

const LAST_MODIFIED = 'Fri, 06 Nov 2026 06:00:00 GMT';

/** A feed that publishes one fixed stage and honours `If-Modified-Since`. */
function startFeed(): Promise<number> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').replace(/^\/+/, '').replace(/\?.*$/, '');
    const body = FEED[path];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const since = req.headers['if-modified-since'];
    if (since && Date.parse(since) >= Date.parse(LAST_MODIFIED)) {
      res.writeHead(304, { 'last-modified': LAST_MODIFIED });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/xml',
      'last-modified': LAST_MODIFIED,
    });
    res.end(body);
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(
    () => (server.address() as { port: number }).port
  );
}

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

async function waitForCycles(
  port: number,
  atLeast: number,
  timeoutMs = 30_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let health = await waitForHealth(port);
  while (Number(health.cycleCount) < atLeast && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    health = await waitForHealth(port);
  }
  return health;
}

function spawnCollector(
  feedPort: number,
  healthPort: number,
  dir: string,
  cachePath: string
): { child: ChildProcess; stderr: () => string } {
  let stderr = '';
  const child = spawn('npx', ['tsx', 'packages/collector/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTION_YEAR: '2026',
      XML_FEED_BASE_URL: `http://127.0.0.1:${feedPort}/`,
      // Keep the spawned collector off the network: prior cycles fall back to
      // the real archive unless this is off.
      PRIOR_RESULTS: 'off',
      DB_PATH: join(dir, 'election_results.db'),
      RESULTS_CACHE_PATH: cachePath,
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
  return { child, stderr: () => stderr };
}

async function snapshotCount(healthPort: number): Promise<number> {
  const snapshots = (await fetch(
    `http://127.0.0.1:${healthPort}/history/snapshots`
  ).then((r) => r.json())) as unknown[];
  return snapshots.length;
}

describe('a quiet feed', () => {
  test('writes no snapshot for a poll where nothing changed', async () => {
    const feedPort = await startFeed();
    const healthPort = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'collector-unchanged-'));
    try {
      const { stderr } = spawnCollector(
        feedPort,
        healthPort,
        dir,
        join(dir, 'electorate_results.json')
      );

      // Four-plus polls at the one-second interval: the first publishes, the
      // rest must 304 and stay silent.
      const health = await waitForCycles(healthPort, 4);
      expect(health.lastError, stderr()).toBeNull();
      expect(health.lastVotesCounted).toBe(1000);

      expect(await snapshotCount(healthPort)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('retries a publish that failed instead of treating the feed as unchanged', async () => {
    const feedPort = await startFeed();
    const healthPort = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'collector-retry-'));
    // A file where the cache's parent directory should be, so every cycle
    // writes its snapshot and then fails to cache: the signature is only
    // recorded after the publish completes, so the next quiet poll tries again.
    const blocker = join(dir, 'cache-parent');
    writeFileSync(blocker, '');
    try {
      const { stderr } = spawnCollector(
        feedPort,
        healthPort,
        dir,
        join(blocker, 'electorate_results.json')
      );

      const health = await waitForCycles(healthPort, 3);
      expect(String(health.lastError), stderr()).toContain('cache-parent');
      // The retry is attempted, but the publication key makes it idempotent:
      // the snapshot that did commit is not written a second time. The error
      // staying set is what proves it is still retrying rather than treating
      // the feed as unchanged.
      expect(await snapshotCount(healthPort)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
