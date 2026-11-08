/**
 * Main-thread client for the SQLite worker (`db-worker.ts`).
 *
 * The client owns three policies the worker must not:
 *
 * - **A bounded queue.** A burst of history requests or a slow write cannot
 *   grow the request list without limit. Overflow rejects with
 *   `DbUnavailableError`, which the history handler turns into an explicit 503
 *   and the scrape loop logs as a failed snapshot.
 * - **A deadline.** Every request has one, so a wedged worker cannot leave a
 *   caller waiting forever. The worker may still finish a timed-out write; the
 *   caller treats it as failed and the next scrape retries (the same
 *   at-least-once behaviour as a network timeout elsewhere).
 * - **Failure reporting.** If the worker exits or errors, every pending and
 *   queued request is rejected and `onFatal` fires. Persistence is then
 *   unavailable, never an empty result set.
 *
 * Requests run one at a time. That keeps transaction ordering and means a read
 * never observes a half-written snapshot.
 */

import { Worker } from 'node:worker_threads';
import { existsSync, unlinkSync } from 'node:fs';
import type { DbRequest, DbResponse, DbResultByType } from './db-protocol.js';
import type {
  ElectorateHistoryRow,
  HistoryPage,
  HistoryPageRequest,
  HistoryReader,
  LatestStateRow,
  PartyVoteHistoryRow,
  SnapshotMetaRow,
} from './history-queries.js';
import type { LatestStateWrite, PruneResult, SnapshotWrite } from './db.js';

export class DbUnavailableError extends Error {
  readonly code = 'unavailable';
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}

export interface DbWorkerClientOptions {
  /** Worker entry; defaults to the sibling `db-worker.ts`. */
  workerUrl?: URL;
  /** Test seam; production constructs the real worker. */
  createWorker?: () => Worker;
  /** Requests the worker may hold at once. One keeps transaction order. */
  maxInFlight?: number;
  /** Requests that may wait for a slot before the queue is refused. */
  maxQueued?: number;
  /** Called once when the worker dies unexpectedly. */
  onFatal?: (err: Error) => void;
}

type QueueEntry = {
  request: DbRequest;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  dispatched: boolean;
};

const DEFAULT_MAX_IN_FLIGHT = 1;
const DEFAULT_MAX_QUEUED = 64;

const TIMEOUTS: Record<DbRequest['type'], number> = {
  open: 60_000,
  close: 10_000,
  write: 30_000,
  writeLatest: 30_000,
  latest: 5_000,
  prune: 60_000,
  compact: 60_000,
  snapshots: 5_000,
  electorate: 5_000,
  partyVotes: 5_000,
};

export class DbWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, QueueEntry>();
  private readonly queue: QueueEntry[] = [];
  private inFlight = 0;
  private ready = false;
  private closing = false;

  private readonly maxInFlight: number;
  private readonly maxQueued: number;

  constructor(private readonly options: DbWorkerClientOptions = {}) {
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
  }

  isReady(): boolean {
    return this.ready;
  }

  async open(dbPath: string): Promise<void> {
    if (this.worker) throw new Error('db worker is already running');
    this.closing = false;

    const worker =
      this.options.createWorker?.() ??
      new Worker(
        this.options.workerUrl ?? new URL('./db-worker.ts', import.meta.url),
        // The collector runs TypeScript through tsx; a nested worker needs the
        // same loader. Vitest uses the same entry through this argument.
        { execArgv: ['--import', 'tsx'] }
      );
    this.worker = worker;

    worker.on('message', (response: DbResponse) => this.onMessage(response));
    worker.on('error', (err: Error) => this.failAll(err));
    worker.on('exit', (code) => {
      if (this.closing) return;
      this.failAll(new Error(`db worker exited with code ${code}`));
    });

    await this.enqueue<'open'>({ type: 'open', dbPath });
    this.ready = true;
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    this.closing = true;
    try {
      if (this.ready) await this.enqueue<'close'>({ type: 'close' });
    } catch {
      // Closing is best effort; terminate below regardless.
    } finally {
      this.ready = false;
      const worker = this.worker;
      this.worker = null;
      await worker?.terminate();
      this.failAll(new DbUnavailableError('db worker is closed'));
    }
  }

  writeLatest(write: LatestStateWrite): Promise<number> {
    return this.enqueue<'writeLatest'>({ type: 'writeLatest', write });
  }

  write(snapshot: SnapshotWrite): Promise<number> {
    // Fault-injection harness for the release rehearsal: creating the file
    // makes exactly the next write fail, without a restart. Off unless the
    // variable is set, and it never exists in a normal deployment.
    const faultFile = process.env.COLLECTOR_FAULT_WRITE_FILE;
    if (faultFile && existsSync(faultFile)) {
      unlinkSync(faultFile);
      return Promise.reject(new Error('injected database write failure'));
    }
    return this.enqueue<'write'>({ type: 'write', snapshot });
  }

  prune(keepHours: number): Promise<PruneResult> {
    return this.enqueue<'prune'>({ type: 'prune', keepHours });
  }

  compact(maxPages?: number): Promise<number> {
    return this.enqueue<'compact'>({ type: 'compact', maxPages });
  }

  latest(electionYear: string): Promise<LatestStateRow | null> {
    return this.enqueue<'latest'>({ type: 'latest', electionYear });
  }

  snapshots(
    electionYear: string,
    page: HistoryPageRequest
  ): Promise<HistoryPage<SnapshotMetaRow>> {
    return this.enqueue<'snapshots'>({ type: 'snapshots', electionYear, page });
  }

  electorate(
    name: string,
    electionYear: string,
    page: HistoryPageRequest
  ): Promise<HistoryPage<ElectorateHistoryRow>> {
    return this.enqueue<'electorate'>({
      type: 'electorate',
      name,
      electionYear,
      page,
    });
  }

  partyVotes(
    electionYear: string,
    page: HistoryPageRequest
  ): Promise<HistoryPage<PartyVoteHistoryRow>> {
    return this.enqueue<'partyVotes'>({
      type: 'partyVotes',
      electionYear,
      page,
    });
  }

  historyReader(): HistoryReader {
    return {
      snapshots: (year, page) => this.snapshots(year, page),
      latest: (year) => this.latest(year),
      electorate: (name, year, page) => this.electorate(name, year, page),
      partyVotes: (year, page) => this.partyVotes(year, page),
    };
  }

  /** The worker's id, useful in logs; null when it has not started. */
  workerThreadId(): number | null {
    return this.worker?.threadId ?? null;
  }

  private enqueue<T extends DbRequest['type']>(
    request: Omit<Extract<DbRequest, { type: T }>, 'id'>
  ): Promise<DbResultByType[T]> {
    if (!this.worker) {
      return Promise.reject(new DbUnavailableError('db worker is not running'));
    }
    if (request.type !== 'open' && !this.ready) {
      return Promise.reject(new DbUnavailableError('db worker is not ready'));
    }

    const full = { ...request, id: this.nextId++ } as DbRequest;

    return new Promise<DbResultByType[T]>((resolve, reject) => {
      const entry: QueueEntry = {
        request: full,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: null,
        dispatched: false,
      };

      if (this.inFlight < this.maxInFlight) {
        this.dispatch(entry);
        return;
      }

      if (this.queue.length >= this.maxQueued) {
        reject(
          new DbUnavailableError(
            `db worker queue is full (${this.maxQueued} waiting)`
          )
        );
        return;
      }

      entry.timer = setTimeout(() => this.expire(entry), TIMEOUTS[full.type]);
      entry.timer.unref?.();
      this.queue.push(entry);
    });
  }

  private dispatch(entry: QueueEntry): void {
    const worker = this.worker;
    if (!worker) {
      entry.reject(new DbUnavailableError('db worker is not running'));
      return;
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.dispatched = true;
    this.inFlight += 1;
    this.pending.set(entry.request.id, entry);
    entry.timer = setTimeout(
      () => this.expire(entry),
      TIMEOUTS[entry.request.type]
    );
    entry.timer.unref?.();
    worker.postMessage(entry.request);
  }

  private pump(): void {
    while (this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (entry.timer) clearTimeout(entry.timer);
      this.dispatch(entry);
    }
  }

  private onMessage(response: DbResponse): void {
    const entry = this.pending.get(response.id);
    // A response for a request that already timed out is ignored.
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(response.id);
    this.inFlight = Math.max(0, this.inFlight - 1);

    if (response.ok) {
      entry.resolve(response.value);
    } else if (response.error.code === 'unavailable') {
      entry.reject(new DbUnavailableError(response.error.message));
    } else {
      entry.reject(new Error(response.error.message));
    }
    this.pump();
  }

  private expire(entry: QueueEntry): void {
    if (entry.dispatched) {
      this.pending.delete(entry.request.id);
      this.inFlight = Math.max(0, this.inFlight - 1);
    } else {
      const index = this.queue.indexOf(entry);
      if (index !== -1) this.queue.splice(index, 1);
    }
    entry.reject(
      new DbUnavailableError(
        `db worker request '${entry.request.type}' timed out after ${TIMEOUTS[entry.request.type]}ms`
      )
    );
    this.pump();
  }

  private failAll(err: Error): void {
    const wasRunning = this.worker !== null;
    this.ready = false;
    this.worker = null;

    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(
        err instanceof DbUnavailableError
          ? err
          : new DbUnavailableError(err.message)
      );
    }
    this.pending.clear();
    this.inFlight = 0;

    for (const entry of this.queue.splice(0)) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new DbUnavailableError(err.message));
    }

    if (wasRunning && this.options.onFatal) this.options.onFatal(err);
  }
}
