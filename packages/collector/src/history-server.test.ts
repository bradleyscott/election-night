import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import { createHistoryHandler } from './history-server.js';
import type { ElectionResultsService } from '@election-night/core/election-results-service';
import type { PriorWinnersResponse } from '@election-night/core/history';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

function makeResult(
  votes: number,
  electorateName = 'Test Electorate'
): Results {
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
      predictionStatus: 'leaning',
    },
    marginOfError: 0.02,
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
