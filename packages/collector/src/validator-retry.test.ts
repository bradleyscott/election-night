import { afterEach, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A body fetched with a new validator must not lose that validator's pairing
 * when the commit fails.
 *
 * Sequence: A commits. B arrives with a newer stamp, but the database write
 * fails. The collector must keep B pending. If it advanced the validator when
 * B arrived instead, the next poll would ask with B's stamp, the source would
 * answer 304, and the old cached A would be published again — B lost until the
 * feed happened to republish it. The test makes the source answer 304-only
 * after the failure, so only a held pending body can recover.
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

type Stage = { votes: number; lastModified: string };

const STAGE_A: Stage = {
  votes: 1000,
  lastModified: 'Fri, 06 Nov 2026 06:00:00 GMT',
};
const STAGE_B: Stage = {
  votes: 2000,
  lastModified: 'Fri, 06 Nov 2026 07:00:00 GMT',
};

function feed(stage: Stage): Record<string, string> {
  const { votes } = stage;
  const major = Math.round(votes * 0.7);
  const minor = votes - major;
  return {
    'candidates.xml': `<?xml version="1.0" encoding="UTF-8"?>
<candidates>
  <candidate c_no="1"><candidate_name>ALICE, Alison</candidate_name><electorate>1</electorate><party>10</party><list_no>1</list_no></candidate>
  <candidate c_no="2"><candidate_name>BOB, Robert</candidate_name><electorate>1</electorate><party>11</party><list_no>1</list_no></candidate>
</candidates>`,
    'parties.xml': `<?xml version="1.0" encoding="UTF-8"?>
<parties>
  <party p_no="10"><abbrev>RED</abbrev><short_name>Red Party</short_name><party_name>Red Party</party_name><registered>yes</registered></party>
  <party p_no="11"><abbrev>BLU</abbrev><short_name>Blue Party</short_name><party_name>Blue Party</party_name><registered>yes</registered></party>
</parties>`,
    'electorates.xml': `<?xml version="1.0" encoding="UTF-8"?>
<electorates><electorate e_no="1"><electorate_name>Auckland Central</electorate_name></electorate></electorates>`,
    'e01/e01.xml': `<?xml version="1.0" encoding="UTF-8"?>
<electorate e_no="1" final="false" updated="2026-11-06T19:00:00">
  <statistics>
    <total_voting_places>10</total_voting_places>
    <total_voting_places_counted>6</total_voting_places_counted>
    <percent_voting_places_counted>60.0</percent_voting_places_counted>
    <total_votes_cast>${votes}</total_votes_cast>
    <percent_votes_cast>10.0</percent_votes_cast>
  </statistics>
  <partyvotes>
    <party p_no="10"><votes>${major}</votes></party>
    <party p_no="11"><votes>${minor}</votes></party>
  </partyvotes>
  <candidatevotes>
    <candidate c_no="1"><votes>${major}</votes></candidate>
    <candidate c_no="2"><votes>${minor}</votes></candidate>
  </candidatevotes>
</electorate>`,
    'election.xml': `<?xml version="1.0" encoding="UTF-8"?>
<election updated="2026-11-06T19:00:00">
  <statistics>
    <total_votes_cast>${votes}</total_votes_cast>
    <percent_votes_cast>10.0</percent_votes_cast>
    <total_electorates_final>1</total_electorates_final>
    <percent_electorates_final>100.00</percent_electorates_final>
  </statistics>
  <partystatus>
    <party p_no="10"><votes>${major}</votes><percent_votes>70</percent_votes><party_seats>1</party_seats><candidate_seats>1</candidate_seats><total_seats>1</total_seats></party>
    <party p_no="11"><votes>${minor}</votes><percent_votes>30</percent_votes><party_seats>0</party_seats><candidate_seats>0</candidate_seats><total_seats>0</total_seats></party>
  </partystatus>
</election>`,
  };
}

function startFeed(): {
  port: Promise<number>;
  setStage: (stage: Stage) => void;
  force304: () => void;
} {
  let stage = STAGE_A;
  let always304 = false;
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').replace(/^\/+/, '').replace(/\?.*$/, '');
    const body = feed(stage)[path];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const since = req.headers['if-modified-since'];
    if (
      always304 ||
      (since && Date.parse(since) >= Date.parse(stage.lastModified))
    ) {
      res.writeHead(304, { 'last-modified': stage.lastModified });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/xml',
      'last-modified': stage.lastModified,
    });
    res.end(body);
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  return {
    port: once(server, 'listening').then(
      () => (server.address() as { port: number }).port
    ),
    setStage: (next) => {
      stage = next;
    },
    force304: () => {
      always304 = true;
    },
  };
}

async function waitFor<T>(
  read: () => Promise<T | null>,
  predicate: (value: T) => boolean,
  timeoutMs = 30_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value !== null && predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('condition did not become true');
}

async function health(port: number): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  return (await res.json()) as Record<string, unknown>;
}

async function latestVotes(port: number): Promise<number | null> {
  const res = await fetch(
    `http://127.0.0.1:${port}/history/electorate/${encodeURIComponent('Auckland Central')}`
  );
  if (!res.ok) return null;
  const points = (await res.json()) as { votesCounted: number }[];
  return points.at(-1)?.votesCounted ?? null;
}

async function snapshots(port: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/history/snapshots`);
  if (!res.ok) return 0;
  return ((await res.json()) as unknown[]).length;
}

describe('conditional validator paired with its committed body', () => {
  test('recovers a fetched body after a failed write even if the source now 304s', async () => {
    const feedServer = startFeed();
    const feedPort = await feedServer.port;
    const healthPort = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'collector-validator-'));
    const faultFile = join(dir, 'fail-write');
    let logs = '';

    const child = spawn('npx', ['tsx', 'packages/collector/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTION_YEAR: '2026',
        XML_FEED_BASE_URL: `http://127.0.0.1:${feedPort}/`,
        PRIOR_RESULTS: 'off',
        DB_PATH: join(dir, 'election_results.db'),
        RESULTS_CACHE_PATH: join(dir, 'electorate_results.json'),
        HEALTH_PORT: String(healthPort),
        WS_URL: 'ws://127.0.0.1:1',
        POLL_INTERVAL_MS: '1000',
        COLLECTOR_FAULT_WRITE_FILE: faultFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stdout?.on('data', (chunk) => {
      logs += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      logs += String(chunk);
    });

    try {
      // A commits.
      await waitFor(
        async () => latestVotes(healthPort),
        (votes) => votes === STAGE_A.votes
      ).catch((err) => {
        throw new Error(`${err.message}\n--- collector log ---\n${logs}`);
      });
      expect(await snapshots(healthPort)).toBe(1);

      // B arrives with a newer stamp; the write fails once.
      writeFileSync(faultFile, '');
      feedServer.setStage(STAGE_B);
      await waitFor(
        async () => (await health(healthPort)).lastError,
        (reason) => String(reason).includes('injected database write failure')
      ).catch((err) => {
        throw new Error(`${err.message}\n--- collector log ---\n${logs}`);
      });

      // The source now answers 304 to everything, so only the held body can
      // recover B.
      feedServer.force304();

      await waitFor(
        async () => latestVotes(healthPort),
        (votes) => votes === STAGE_B.votes,
        40_000
      ).catch((err) => {
        throw new Error(`${err.message}\n--- collector log ---\n${logs}`);
      });

      // A and B, not a duplicate from the retry.
      expect(await snapshots(healthPort)).toBe(2);
      expect((await health(healthPort)).lastError).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
