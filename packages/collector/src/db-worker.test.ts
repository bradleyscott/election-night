import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ElectorateResult } from '@election-night/core/types';
import { DbWorkerClient } from './db-worker-client.js';
import type { DbRequest } from './db-protocol.js';
import { startHealthServer } from './health.js';

function makeResult(votes = 5_000): ElectorateResult {
  return {
    electorateName: 'Test Electorate',
    partyVotes: [
      { candidate: 'National Party', votes },
      { candidate: 'Labour Party', votes: votes - 100 },
    ],
    candidateVotes: [
      { candidate: 'Smith, John', party: 'National Party', votes: votes + 50 },
      { candidate: 'Jones, Mary', party: 'Labour Party', votes: votes - 50 },
    ],
    votesCounted: votes * 2,
    votePercentageCounted: 0.5,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 100,
      marginPercent: 0.01,
    },
  };
}

const page = { windowHours: 24, limit: 2_000, offset: 0 };

describe('DbWorkerClient', () => {
  let client: DbWorkerClient | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await client?.close();
    client = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('runs migrations, writes a snapshot, reads it back and prunes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'db-worker-test-'));
    const path = join(dir, 'worker.db');
    client = new DbWorkerClient();

    await client.open(path);
    expect(client.isReady()).toBe(true);

    const scrapeId = await client.write({
      results: [makeResult()],
      partyVote: [],
      partyLists: [],
      electionYear: '2026',
      // The caller computes progress; the worker never receives a function.
      progressByElectorate: { 'Test Electorate': 0.8 },
    });
    expect(scrapeId).toBeGreaterThan(0);

    const snapshots = await client.snapshots('2026', page);
    expect(snapshots.total).toBe(1);
    expect(snapshots.rows[0]!.snapshotId).toBe(scrapeId);

    const electorate = await client.electorate('Test Electorate', '2026', page);
    expect(electorate.total).toBe(1);
    expect(electorate.rows[0]!.candidates[0]!.candidate).toBe('Smith, John');
    // progress came from progressByElectorate, not the result's own 0.5.
    expect(electorate.rows[0]!.votePctCounted).toBeCloseTo(0.8);

    const party = await client.partyVotes('2026', page);
    expect(party.total).toBe(1);

    const pruned = await client.prune(24);
    expect(pruned.deletedSnapshots).toBe(0);
    expect(await client.compact()).toBeGreaterThanOrEqual(0);

    await client.close();
    expect(client.isReady()).toBe(false);
  });

  it('refuses work before open and after close', async () => {
    client = new DbWorkerClient();
    await expect(client.snapshots('2026', page)).rejects.toMatchObject({
      code: 'unavailable',
    });

    dir = mkdtempSync(join(tmpdir(), 'db-worker-test-'));
    await client.open(join(dir, 'worker.db'));
    await client.close();
    await expect(client.snapshots('2026', page)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});

/** A controllable stand-in for the worker thread. */
class FakeWorker extends EventEmitter {
  readonly threadId = 1;
  readonly sent: DbRequest[] = [];

  postMessage(request: DbRequest): void {
    this.sent.push(request);
    if (request.type === 'close') {
      queueMicrotask(() => this.respond(request.id, null));
    }
  }

  terminate(): Promise<number> {
    this.emit('exit', 0);
    return Promise.resolve(0);
  }

  respond(id: number, value: unknown): void {
    this.emit('message', { id, ok: true, value });
  }

  respondError(id: number, message: string): void {
    this.emit('message', {
      id,
      ok: false,
      error: { message, code: 'query' },
    });
  }
}

function makeWrite() {
  return {
    results: [makeResult()],
    partyVote: [],
    partyLists: [],
    electionYear: '2026',
    progressByElectorate: { 'Test Electorate': 0.8 },
  };
}

async function openWith(
  fake: FakeWorker,
  options: Partial<import('./db-worker-client.js').DbWorkerClientOptions> = {}
): Promise<DbWorkerClient> {
  const client = new DbWorkerClient({
    createWorker: () => fake as unknown as Worker,
    ...options,
  });
  const opening = client.open('/tmp/not-used.db');
  fake.respond(fake.sent[0]!.id, null);
  await opening;
  return client;
}

describe('DbWorkerClient bounds and failure', () => {
  let client: DbWorkerClient | null = null;

  afterEach(async () => {
    await client?.close();
    client = null;
  });

  it('rejects overflow rather than growing the queue without bound', async () => {
    const fake = new FakeWorker();
    client = await openWith(fake, { maxQueued: 1 });

    // One in flight, one waiting, the third is refused.
    const first = client.snapshots('2026', page);
    const second = client.snapshots('2026', page);
    await expect(client.snapshots('2026', page)).rejects.toMatchObject({
      code: 'unavailable',
    });

    const empty = { rows: [], total: 0 };
    fake.respond(fake.sent[1]!.id, empty);
    fake.respond(fake.sent[2]!.id, empty);
    await Promise.all([first, second]);
  });

  it('rejects every request and reports the failure when the worker dies', async () => {
    const onFatal = vi.fn();
    const fake = new FakeWorker();
    client = new DbWorkerClient({
      createWorker: () => fake as unknown as Worker,
      onFatal,
    });
    const opening = client.open('/tmp/not-used.db');
    fake.respond(fake.sent[0]!.id, null);
    await opening;

    const inFlight = client.snapshots('2026', page);
    const queued = client.snapshots('2026', page);
    fake.emit('exit', 1);

    await expect(inFlight).rejects.toMatchObject({ code: 'unavailable' });
    await expect(queued).rejects.toMatchObject({ code: 'unavailable' });
    expect(onFatal).toHaveBeenCalledTimes(1);
    await expect(client.snapshots('2026', page)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('surfaces a query error as a plain error, not unavailability', async () => {
    const fake = new FakeWorker();
    client = await openWith(fake);

    const read = client.snapshots('2026', page);
    fake.respondError(fake.sent[1]!.id, 'no such table');

    await expect(read).rejects.toThrow('no such table');
    // A query error does not close the worker.
    const next = client.snapshots('2026', page);
    fake.respond(fake.sent[2]!.id, { rows: [], total: 0 });
    await expect(next).resolves.toMatchObject({ total: 0 });
  });

  it('keeps /health answering while a database request is outstanding', async () => {
    const fake = new FakeWorker();
    client = await openWith(fake);

    // A request the worker never answers stands in for a blocked job.
    const blocked = client.write(makeWrite());

    const server = startHealthServer(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    fake.respond(fake.sent[1]!.id, 1);
    await expect(blocked).resolves.toBe(1);
  });
});
