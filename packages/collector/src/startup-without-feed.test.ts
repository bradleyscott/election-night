import { afterEach, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createSocketServer } from 'node:net';

/**
 * The collector must survive a feed that is not published yet.
 *
 * This is not hypothetical: the next cycle's XML feed 404s until results start
 * flowing, and the combined image's entrypoint tears the machine down when the
 * collector exits (`wait -n`). When the initial source load called
 * `process.exit(1)`, a 404ing feed crash-looped the whole deployment — the
 * dashboard included — and Fly's restart budget ran out.
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

/** A port nobody is listening on, for the health server to bind. */
async function freePort(): Promise<number> {
  const probe = createSocketServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function getHealth(
  port: number
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function waitForHealth(
  port: number,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await getHealth(port);
    if (health) return health;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`/health did not answer on :${port} within ${timeoutMs}ms`);
}

describe('collector startup without a published feed', () => {
  test('stays up, serves /health, and reports why it has no results', async () => {
    // Stand in for the Electoral Commission feed: a 404 until results exist.
    const feed = createServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    });
    servers.push(feed);
    feed.listen(0, '127.0.0.1');
    await once(feed, 'listening');
    const feedPort = (feed.address() as { port: number }).port;

    const healthPort = await freePort();
    dir = mkdtempSync(join(tmpdir(), 'collector-nofeed-'));

    let stderr = '';
    const child = spawn('npx', ['tsx', 'packages/collector/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTION_YEAR: '2026',
        XML_FEED_BASE_URL: `http://127.0.0.1:${feedPort}/`,
        DB_PATH: join(dir, 'election_results.db'),
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

    // The collector is up and answering even though it cannot scrape.
    const health = await waitForHealth(healthPort);
    expect(health.lastCycleOk).toBe(false);
    expect(String(health.lastError)).toContain('election source unavailable');

    // Survives several failed polls: the loop must retry, not exit.
    await new Promise((r) => setTimeout(r, 2500));
    expect(child.exitCode, `collector exited early:\n${stderr}`).toBeNull();
    expect(await getHealth(healthPort)).not.toBeNull();
  }, 40_000);
});
