import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ElectorateResult } from '@election-night/core/types';
import { createHistoryHandler } from './history-server.js';
import type { ElectionResultsService } from '@election-night/core/election-results-service';
import type { PriorWinnersResponse } from '@election-night/core/history';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeResult(
  votes: number,
  electorateName = 'Test Electorate'
): ElectorateResult {
  return {
    electorateName,
    partyVotes: [
      { candidate: 'National Party', votes },
      { candidate: 'Labour Party', votes: Math.floor(votes * 0.9) },
    ],
    candidateVotes: [
      { candidate: 'Smith, John', party: 'National Party', votes: votes + 200 },
      { candidate: 'Jones, Mary', party: 'Labour Party', votes },
    ],
    votesCounted: votes * 2,
    votePercentageCounted: 0.5,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 200,
      marginPercent: 0.02,
    },
  };
}

describe('history-server', () => {
  let tmpDir: string;
  let dbPath: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'history-server-test-'));
    dbPath = join(tmpDir, 'test.db');
    const { openDb, writeResults, closeDb } = await import('./db.js');
    openDb(dbPath);
    // A DB holding both cycles, to prove history is scoped to one of them.
    writeResults([makeResult(5000, 'Wellington Central')], [], [], '2023');
    writeResults([makeResult(6000)], [], [], '2026');
    writeResults([makeResult(7000)], [], [], '2026');
    closeDb();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function start(
    electionYear?: string,
    resultsService?: ElectionResultsService,
    path = dbPath
  ): Promise<void> {
    const handler = createHistoryHandler({
      dbPath: path,
      electionYear,
      resultsService,
    });
    server = http.createServer((req, res) => {
      if (!handler(req, res)) {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  test('serves snapshots with no configuration (open by default)', async () => {
    await start('2026');
    const res = await fetch(`${baseUrl}/history/snapshots`);
    expect(res.status).toBe(200);
    const metas = (await res.json()) as {
      snapshotId: number;
      electionYear: string;
      startedAt: string;
    }[];
    expect(metas).toHaveLength(2);
    expect(metas.every((m) => m.electionYear === '2026')).toBe(true);
    expect(metas[0]!.startedAt).toBeTruthy();
  });

  test('excludes other cycles from the configured year', async () => {
    await start('2023');
    const res = await fetch(`${baseUrl}/history/snapshots`);
    const metas = (await res.json()) as { electionYear: string }[];
    expect(metas).toHaveLength(1);
    expect(metas[0]!.electionYear).toBe('2023');
  });

  test('honours an explicit ?year= override', async () => {
    await start('2026');
    const res = await fetch(`${baseUrl}/history/snapshots?year=2023`);
    const metas = (await res.json()) as { electionYear: string }[];
    expect(metas).toHaveLength(1);
    expect(metas[0]!.electionYear).toBe('2023');
  });

  /**
   * Build a throwaway DB holding only the given cycle, to model a volume that
   * has not yet seen the new cycle.
   */
  async function dbWithOnly2023(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'history-server-fresh-'));
    const path = join(dir, 'fresh.db');
    const { openDb, writeResults, closeDb } = await import('./db.js');
    openDb(path);
    writeResults([makeResult(4000)], [], [], '2023');
    closeDb();
    return path;
  }

  function requestJson(
    handler: ReturnType<typeof createHistoryHandler>,
    url: string
  ): Promise<{ electionYear: string }[]> {
    return new Promise((resolve) => {
      const res = {
        writeHead: () => {},
        end: (body: string) => resolve(JSON.parse(body)),
      } as unknown as import('node:http').ServerResponse;
      handler(
        { url, method: 'GET' } as import('node:http').IncomingMessage,
        res
      );
    });
  }

  test('does not substitute another cycle when the configured year has no rows', async () => {
    const legacyDb = await dbWithOnly2023();
    const handler = createHistoryHandler({
      dbPath: legacyDb,
      electionYear: '2026',
    });

    // Nothing for 2026 yet: serve nothing rather than last cycle's results.
    expect(await requestJson(handler, '/history/snapshots')).toEqual([]);
    // The legacy rows are still reachable when asked for explicitly.
    const legacy = await requestJson(handler, '/history/snapshots?year=2023');
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.electionYear).toBe('2023');

    rmSync(dirname(legacyDb), { recursive: true, force: true });
  });

  test('falls back to the newest cycle in the DB when no year is configured', async () => {
    const legacyDb = await dbWithOnly2023();
    const handler = createHistoryHandler({ dbPath: legacyDb });

    const metas = await requestJson(handler, '/history/snapshots');
    rmSync(dirname(legacyDb), { recursive: true, force: true });

    expect(metas).toHaveLength(1);
    expect(metas[0]!.electionYear).toBe('2023');
  });

  test('serves electorate history with candidates and party votes', async () => {
    await start('2026');
    const res = await fetch(
      `${baseUrl}/history/electorate/${encodeURIComponent('Test Electorate')}`
    );
    expect(res.status).toBe(200);
    const history = (await res.json()) as {
      candidates: { candidate: string; votes: number }[];
      partyVotes: { party: string; votes: number }[];
    }[];
    expect(history).toHaveLength(2);
    expect(history[0]!.candidates[0]!.candidate).toBe('Smith, John');
    expect(history[0]!.partyVotes[0]!.party).toBe('National Party');
  });

  test('serves party-vote history', async () => {
    await start('2026');
    const res = await fetch(`${baseUrl}/history/party-votes`);
    expect(res.status).toBe(200);
    const history = (await res.json()) as { snapshotId: number }[];
    expect(history).toHaveLength(2);
  });

  test('503s when the DB does not exist yet', async () => {
    dbPath = join(tmpDir, 'missing.db');
    await start();
    const res = await fetch(`${baseUrl}/history/snapshots`);
    expect(res.status).toBe(503);
  });

  test('leaves non-history routes unhandled', async () => {
    await start();
    const res = await fetch(`${baseUrl}/other`);
    expect(res.status).toBe(404);
  });

  test('serves the authoritative latest payload with its revision', async () => {
    await start('2026');
    const res = await fetch(`${baseUrl}/history/latest`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-election-revision')).toBe('2');
    const body = (await res.json()) as {
      revision: number;
      payload: {
        electorateResults: unknown[];
        partyVote: unknown[];
        partyLists: unknown[];
      };
    };
    expect(body.revision).toBe(2);
    expect(body.payload.electorateResults.length).toBeGreaterThan(0);
    expect(Array.isArray(body.payload.partyVote)).toBe(true);
    expect(Array.isArray(body.payload.partyLists)).toBe(true);
  });

  describe('results service routes', () => {
    const priorWinners: PriorWinnersResponse = {
      currentYear: '2026',
      primaryYear: '2023',
      years: [
        {
          year: '2023',
          winners: [
            {
              electorateName: 'Remutaka',
              priorElectorateName: null,
              year: '2023',
              candidate: 'JONES, Mary',
              party: 'Labour Party',
              votes: 20_000,
              majority: 3_000,
              majorityPercent: 0.15,
            },
          ],
        },
      ],
    };

    function stubResults(
      results: Record<string, unknown>
    ): ElectionResultsService {
      return {
        getResults: async (year: string) => results[year] ?? null,
        getPriorWinners: async () => priorWinners,
      } as unknown as ElectionResultsService;
    }

    test('serves prior winners from the results service', async () => {
      await start('2026', stubResults({}));
      const res = await fetch(`${baseUrl}/history/prior-winners`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(priorWinners);
    });

    test('serves an archived cycle as final', async () => {
      const results = {
        year: '2023',
        final: true,
        electorateResults: [],
        partyVote: [],
        partyLists: [],
      };
      await start('2026', stubResults({ '2023': results }));

      const res = await fetch(`${baseUrl}/history/results/2023`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(results);
    });

    test('404s — not an empty 200 — for a year it cannot serve', async () => {
      await start('2026', stubResults({}));
      const res = await fetch(`${baseUrl}/history/results/2014`);
      expect(res.status).toBe(404);
    });

    test('answers without a database, since results are held in memory', async () => {
      await start('2026', stubResults({}), join(tmpDir, 'never-created.db'));
      const res = await fetch(`${baseUrl}/history/prior-winners`);
      expect(res.status).toBe(200);
    });
  });
});

describe('history-server paging and window', () => {
  let tmpDir: string;
  let dbPath: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'history-server-paging-'));
    dbPath = join(tmpDir, 'test.db');
    const { openDb, writeResults, closeDb } = await import('./db.js');
    openDb(dbPath);
    writeResults([makeResult(5000)], [], [], '2026');
    writeResults([makeResult(6000)], [], [], '2026');
    closeDb();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startWith(
    options: Partial<import('./history-server.js').HistoryHandlerOptions> = {}
  ): Promise<void> {
    const handler = createHistoryHandler({
      dbPath,
      electionYear: '2026',
      ...options,
    });
    server = http.createServer((req, res) => {
      if (!handler(req, res)) {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  test('returns a page with explicit total/limit/offset headers', async () => {
    await startWith();
    const res = await fetch(`${baseUrl}/history/snapshots?limit=1&offset=1`);

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
    expect(res.headers.get('x-history-total')).toBe('2');
    expect(res.headers.get('x-history-limit')).toBe('1');
    expect(res.headers.get('x-history-offset')).toBe('1');
    expect(res.headers.get('x-history-window-hours')).toBe('24');
  });

  test('rejects a non-positive or malformed limit', async () => {
    await startWith();
    for (const limit of ['0', 'abc', '-1']) {
      const res = await fetch(`${baseUrl}/history/snapshots?limit=${limit}`);
      expect(res.status).toBe(400);
    }
  });

  test('rejects a malformed year override', async () => {
    await startWith();
    const res = await fetch(`${baseUrl}/history/snapshots?year=abcd`);
    expect(res.status).toBe(400);
  });

  test('rejects a malformed offset', async () => {
    await startWith();
    const res = await fetch(`${baseUrl}/history/snapshots?offset=-1`);
    expect(res.status).toBe(400);
  });

  test('refuses an unpaged window that exceeds the cap instead of truncating', async () => {
    await startWith({ maxSnapshots: 1 });
    const res = await fetch(`${baseUrl}/history/snapshots`);

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({
      total: 2,
      limit: 1,
    });
    expect(res.headers.get('x-history-total')).toBe('2');
  });

  test('an explicit page succeeds even when the window exceeds the cap', async () => {
    await startWith({ maxSnapshots: 1 });
    const res = await fetch(`${baseUrl}/history/snapshots?limit=1&offset=0`);

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  test('excludes snapshots older than the configured window', async () => {
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(dbPath);
    raw
      .prepare(
        "UPDATE scrape_snapshots SET started_at = datetime('now', '-25 hours') WHERE id = (SELECT MIN(id) FROM scrape_snapshots WHERE election_year = '2026')"
      )
      .run();
    raw.close();

    await startWith({ windowHours: 24 });
    const res = await fetch(`${baseUrl}/history/snapshots`);
    const body = (await res.json()) as unknown[];

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(res.headers.get('x-history-total')).toBe('1');
  });
});

describe('history-server worker reader', () => {
  let server: http.Server;
  let baseUrl: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    }
  });

  function reader(
    overrides: Partial<import('./history-queries.js').HistoryReader> = {}
  ): import('./history-queries.js').HistoryReader {
    const empty = async () => ({ rows: [], total: 0 });
    return {
      snapshots: empty,
      latest: async () => null,
      electorate: empty,
      partyVotes: empty,
      ...overrides,
    };
  }

  async function start(
    source: import('./history-queries.js').HistoryReader,
    electionYear: string | null = '2026'
  ): Promise<void> {
    // No DB path is used: the reader owns the connection.
    const handler = createHistoryHandler({
      dbPath: join(tmpdir(), 'never-used.db'),
      electionYear: electionYear ?? undefined,
      reader: source,
    });
    server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  const snapshot = {
    snapshotId: 7,
    electionYear: '2026',
    startedAt: '2026-11-07T07:00:00.000Z',
    completedAt: null,
    revision: 1,
    modelVersion: 1,
  };

  test('serves a page from the worker with the same array body and headers', async () => {
    await start(
      reader({
        snapshots: async () => ({ rows: [snapshot], total: 1 }),
      })
    );

    const res = await fetch(`${baseUrl}/history/snapshots`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([snapshot]);
    expect(res.headers.get('x-history-total')).toBe('1');
  });

  test('maps worker unavailability to a structured 503, never an empty list', async () => {
    await start(
      reader({
        snapshots: async () => {
          throw Object.assign(new Error('db worker queue is full'), {
            code: 'unavailable',
          });
        },
      })
    );

    const res = await fetch(`${baseUrl}/history/snapshots`);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'database unavailable',
    });
  });

  test('rejects bad paging before asking the worker', async () => {
    let called = 0;
    await start(
      reader({
        snapshots: async () => {
          called += 1;
          return { rows: [], total: 0 };
        },
      })
    );

    const res = await fetch(`${baseUrl}/history/snapshots?limit=0`);
    expect(res.status).toBe(400);
    expect(called).toBe(0);
  });

  test('serves the latest state from the worker reader', async () => {
    const latest = {
      electionYear: '2026',
      revision: 4,
      payload: { electorateResults: [], partyVote: [], partyLists: [] },
      source: 'NZ Election XML Feed',
      observedAt: '2026-11-07T07:00:00.000Z',
      phase: 'counting',
      coverage: null,
      modelVersion: 1,
      configVersion: '2026',
      updatedAt: '2026-11-07T07:00:01.000Z',
    };
    await start(reader({ latest: async () => latest }));

    const res = await fetch(`${baseUrl}/history/latest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-election-revision')).toBe('4');
    await expect(res.json()).resolves.toMatchObject({ revision: 4 });
  });

  test('503s when no year is configured and none is requested', async () => {
    await start(reader(), null);
    const res = await fetch(`${baseUrl}/history/snapshots`);
    expect(res.status).toBe(503);
  });
});
