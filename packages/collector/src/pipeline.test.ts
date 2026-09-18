import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, type Server as NetServer } from 'net';
import { once } from 'events';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import type { ResultsPayload } from '@election-night/core/types';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function waitForListening(server: NetServer): Promise<void> {
  if (server.listening) return Promise.resolve();
  return once(server, 'listening').then(() => undefined);
}

function waitForSocketEvent<T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 30_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/**
 * End-to-end: mock XML feed -> in-process collector -> SQLite snapshot, with
 * the payload pushed to a Socket.io client.
 *
 * This is the whole production path. There is no separate collector process
 * and no history HTTP hop any more, so the assertions cover the snapshot the
 * collector wrote and the payload the browser would receive.
 */
describe('pipeline integration', () => {
  let tmpDir: string;
  let dbPath: string;
  let mockPort: number;
  let dashboardPort: number;
  let stopMock: () => void;
  let stopDashboard: () => void;

  beforeAll(async () => {
    mockPort = await getFreePort();
    dashboardPort = await getFreePort();

    tmpDir = mkdtempSync(join(tmpdir(), 'election-night-pipeline-'));
    dbPath = join(tmpDir, 'election_results.db');

    // Must be set before the modules are imported: both read their config at
    // module scope.
    process.env.WS_PORT = String(dashboardPort);
    process.env.MOCK_PORT = String(mockPort);
    process.env.DB_PATH = dbPath;
    process.env.FEED_CACHE_PATH = join(tmpDir, 'feed_events.json');
    process.env.XML_FEED_BASE_URL = `http://localhost:${mockPort}/`;
    process.env.COLLECTOR_ENABLED = 'true';
    process.env.ELECTION_YEAR = '2026';
    // One cycle only: the loop must not run again during the test.
    process.env.POLL_INTERVAL_MS = '600000';

    const mockMod = await import('./serve-mock.js');
    stopMock = mockMod.stopMockServer;
    await waitForListening(mockMod.server);

    // Importing the server starts listening and boots the collector.
    // Imported by URL so TypeScript does not pull the whole dashboard package
    // into the collector's compilation (rootDir).
    const dashMod = await import(
      new URL('../../dashboard/server/index.ts', import.meta.url).href
    );
    stopDashboard = dashMod.stopDashboardServer;
    await waitForListening(dashMod.server);
  }, 60_000);

  afterAll(() => {
    stopDashboard?.();
    stopMock?.();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('collector fetches the mock XML feed, broadcasts results, and writes a snapshot', async () => {
    const client = io(`ws://localhost:${dashboardPort}`, {
      transports: ['websocket', 'polling'],
    });

    // Resolves either from the live broadcast or from the payload the server
    // replays on connect, whichever happens first.
    const update = await waitForSocketEvent<ResultsPayload>(
      client,
      'results_update'
    );

    expect(update.electorateResults.length).toBeGreaterThan(0);
    expect(update.partyVote.length).toBeGreaterThan(0);
    expect(update.partyLists.length).toBeGreaterThan(0);

    const Database = (await import('better-sqlite3')).default;    const conn = new Database(dbPath, { readonly: true });
    const snapshots = conn
      .prepare('SELECT id, election_year AS electionYear FROM scrape_snapshots')
      .all() as { id: number; electionYear: string }[];
    const summaries = conn
      .prepare('SELECT COUNT(*) AS n FROM electorate_summary')
      .get() as { n: number };
    conn.close();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.electionYear).toBe('2026');
    expect(summaries.n).toBe(update.electorateResults.length);

    client.disconnect();
  }, 60_000);

  test('the collector reports state through the server', async () => {
    const res = await fetch(`http://127.0.0.1:${dashboardPort}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      collector: { status: string; cycleCount: number; resultCount: number };
      history: { available: boolean };
    };

    expect(body.status).toBe('ok');
    expect(body.collector.status).toBe('ok');
    expect(body.collector.cycleCount).toBeGreaterThan(0);
    expect(body.collector.resultCount).toBeGreaterThan(0);
    expect(body.history.available).toBe(true);
  }, 30_000);

  test('history is served from the snapshot the collector wrote', async () => {
    const res = await fetch(
      `http://127.0.0.1:${dashboardPort}/api/history/snapshots`
    );
    expect(res.status).toBe(200);

    const metas = (await res.json()) as { snapshotId: number }[];
    expect(metas).toHaveLength(1);
  }, 30_000);

  test('/ready reports the collector as healthy once a cycle has completed', async () => {
    const res = await fetch(`http://127.0.0.1:${dashboardPort}/ready`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ready: boolean;
      checks: Record<string, string | number>;
    };
    expect(body.ready).toBe(true);
    expect(body.checks.collector).toBe('ok');
    expect(body.checks.history).toBe('ok');
  }, 30_000);
});
