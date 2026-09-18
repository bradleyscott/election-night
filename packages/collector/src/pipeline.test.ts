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
  event: string
): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, resolve as (...args: unknown[]) => void);
  });
}

describe('pipeline integration', () => {
  let tmpDir: string;
  let dbPath: string;
  let cachePath: string;
  let mockPort: number;
  let dashboardPort: number;
  let mockServer: any;
  let dashboardServer: any;
  let stopMock: () => void;
  let stopDashboard: () => void;

  beforeAll(async () => {
    mockPort = await getFreePort();
    dashboardPort = await getFreePort();

    tmpDir = mkdtempSync(join(tmpdir(), 'election-night-pipeline-'));
    dbPath = join(tmpDir, 'election_results.db');
    cachePath = join(tmpDir, 'electorate_results.json');

    process.env.WS_PORT = String(dashboardPort);
    process.env.MOCK_PORT = String(mockPort);
    process.env.DB_PATH = dbPath;
    process.env.CACHE_PATH = cachePath;

    const [mockMod, dashMod] = await Promise.all([
      import('./serve-mock.js'),
      import(new URL('../../dashboard/server/index.ts', import.meta.url).href),
    ]);

    mockServer = mockMod.server;
    stopMock = mockMod.stopMockServer;
    dashboardServer = dashMod.server;
    stopDashboard = dashMod.stopDashboardServer;

    await Promise.all([
      waitForListening(mockServer),
      waitForListening(dashboardServer),
    ]);
  }, 30_000);

  afterAll(async () => {
    stopMock?.();
    stopDashboard?.();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);

  test('collector reads the mock XML feed, dashboard receives update, and DB snapshot is written', async () => {
    const { NzElectionXmlSource } =
      await import('@election-night/core/sources');
    const { scrapeCycle } = await import('./scrape-cycle.js');
    const { openDb, closeDb, writeResults } = await import('./db.js');

    const source = new NzElectionXmlSource({
      baseUrl: `http://localhost:${mockPort}/`,
    });
    const configs = await source.loadElectorates();
    const partyListRecords = await source.loadPartyList();

    openDb(dbPath);

    const payload = await scrapeCycle({
      source,
      configs,
      partyListRecords,
      concurrency: 5,
    });

    expect(payload.electorateResults.length).toBeGreaterThan(0);
    expect(payload.partyVote.length).toBeGreaterThan(0);
    expect(payload.partyLists.length).toBeGreaterThan(0);

    const clientSocket = io(`ws://localhost:${dashboardPort}`, {
      transports: ['websocket', 'polling'],
    });
    const updatePromise = waitForSocketEvent<ResultsPayload>(
      clientSocket,
      'results_update'
    );

    const collectorSocket = io(`ws://localhost:${dashboardPort}`, {
      transports: ['websocket', 'polling'],
    });
    await waitForSocketEvent(collectorSocket, 'connect');
    collectorSocket.emit('results_update', payload);

    const update = await updatePromise;
    expect(update.electorateResults.length).toBe(
      payload.electorateResults.length
    );
    expect(update.partyVote.length).toBe(payload.partyVote.length);

    writeResults(
      payload.electorateResults,
      payload.partyVote,
      payload.partyLists,
      '2026'
    );

    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(dbPath);
    const snapshots = conn.prepare('SELECT id FROM scrape_snapshots').all() as {
      id: number;
    }[];
    conn.close();
    expect(snapshots.length).toBe(1);

    clientSocket.disconnect();
    collectorSocket.disconnect();
    closeDb();
  }, 120_000);
});
