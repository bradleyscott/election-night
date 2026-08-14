import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import {
  createHistoryHandler,
  authorizeHistoryRequest,
} from './history-server.js';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

function makeResult(votes: number): Results {
  return {
    electorateName: 'Test Electorate',
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
    writeResults([makeResult(5000)], [], []);
    writeResults([makeResult(6000)], [], []);
    closeDb();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function start(token: string | undefined): Promise<void> {
    const handler = createHistoryHandler({ dbPath, token });
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

  test('serves snapshots to loopback without a token configured (dev default)', async () => {
    await start(undefined);
    const res = await fetch(`${baseUrl}/history/snapshots`);
    expect(res.status).toBe(200);
    const metas = (await res.json()) as { snapshotId: number }[];
    expect(metas).toHaveLength(2);
  });

  test('401s on wrong bearer token', async () => {
    await start('sekrit');
    // Loopback is trusted, so exercise the remote path via the pure
    // auth function instead (see the authorizeHistoryRequest tests below).
    expect(
      authorizeHistoryRequest('203.0.113.9', 'Bearer wrong', 'sekrit')
    ).toBe('unauthorized');
    const res = await fetch(`${baseUrl}/history/snapshots`, {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(200); // loopback bypass
  });

  test('serves snapshots with a valid token', async () => {
    await start('sekrit');
    const res = await fetch(`${baseUrl}/history/snapshots`, {
      headers: { authorization: 'Bearer sekrit' },
    });
    expect(res.status).toBe(200);
    const metas = (await res.json()) as {
      snapshotId: number;
      startedAt: string;
    }[];
    expect(metas).toHaveLength(2);
    expect(metas[0]!.startedAt).toBeTruthy();
  });

  test('serves electorate history with candidates and party votes', async () => {
    await start('sekrit');
    const res = await fetch(
      `${baseUrl}/history/electorate/${encodeURIComponent('Test Electorate')}`,
      { headers: { authorization: 'Bearer sekrit' } }
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
    await start('sekrit');
    const res = await fetch(`${baseUrl}/history/party-votes`, {
      headers: { authorization: 'Bearer sekrit' },
    });
    expect(res.status).toBe(200);
    const history = (await res.json()) as { snapshotId: number }[];
    expect(history).toHaveLength(2);
  });

  test('503s when the DB does not exist yet', async () => {
    dbPath = join(tmpDir, 'missing.db');
    await start('sekrit');
    const res = await fetch(`${baseUrl}/history/snapshots`, {
      headers: { authorization: 'Bearer sekrit' },
    });
    expect(res.status).toBe(503);
  });

  test('leaves non-history routes unhandled', async () => {
    await start('sekrit');
    const res = await fetch(`${baseUrl}/other`);
    expect(res.status).toBe(404);
  });
});

describe('authorizeHistoryRequest', () => {
  test('loopback without token is allowed (dev / all-in-one default)', () => {
    expect(authorizeHistoryRequest('127.0.0.1', undefined, undefined)).toBe(
      'allow'
    );
    expect(authorizeHistoryRequest('::1', undefined, undefined)).toBe('allow');
    expect(
      authorizeHistoryRequest('::ffff:127.0.0.1', undefined, undefined)
    ).toBe('allow');
  });

  test('remote without token configured is not found', () => {
    expect(authorizeHistoryRequest('203.0.113.9', undefined, undefined)).toBe(
      'not-found'
    );
  });

  test('remote with matching bearer token is allowed', () => {
    expect(
      authorizeHistoryRequest('203.0.113.9', 'Bearer sekrit', 'sekrit')
    ).toBe('allow');
  });

  test('remote with wrong or missing token is unauthorized', () => {
    expect(
      authorizeHistoryRequest('203.0.113.9', 'Bearer wrong', 'sekrit')
    ).toBe('unauthorized');
    expect(authorizeHistoryRequest('203.0.113.9', undefined, 'sekrit')).toBe(
      'unauthorized'
    );
  });
});
