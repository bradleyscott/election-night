/**
 * The SQLite worker: the only thread that opens the database, migrates it,
 * writes snapshots, reads history or runs retention.
 *
 * Why a worker at all: better-sqlite3 is synchronous. On the main thread a
 * full snapshot write or a retention sweep stops the event loop, which stops
 * `/health` answering even though Socket.io and the scrape loop look alive.
 * Moving the connection here means a blocked write can delay history (bounded
 * by the client's queue/deadline) but cannot stop the health listener.
 *
 * The worker runs requests one at a time in arrival order. That is deliberate:
 * one connection, one transaction at a time, and no interleaving between a
 * write and a read that could observe a half-applied snapshot.
 */

import { parentPort } from 'node:worker_threads';
import {
  closeDb,
  compactDatabase,
  getDbHandle,
  openDb,
  pruneSnapshots,
  writeSnapshot,
} from './db.js';
import {
  queryElectorateHistory,
  queryPartyVoteHistory,
  querySnapshotMetas,
} from './history-queries.js';
import type { DbRequest, DbResponse } from './db-protocol.js';

if (!parentPort) {
  throw new Error('db-worker must be started as a worker thread');
}

const port = parentPort;

function handle(request: DbRequest): unknown {
  switch (request.type) {
    case 'open':
      openDb(request.dbPath);
      return null;
    case 'close':
      closeDb();
      return null;
    case 'write':
      return writeSnapshot(request.snapshot);
    case 'prune':
      return pruneSnapshots(request.keepHours);
    case 'compact':
      return compactDatabase(request.maxPages);
    case 'snapshots':
      return querySnapshotMetas(
        getDbHandle(),
        request.electionYear,
        request.page
      );
    case 'electorate':
      return queryElectorateHistory(
        getDbHandle(),
        request.name,
        request.electionYear,
        request.page
      );
    case 'partyVotes':
      return queryPartyVoteHistory(
        getDbHandle(),
        request.electionYear,
        request.page
      );
  }
}

port.on('message', (request: DbRequest) => {
  let response: DbResponse;
  try {
    response = {
      id: request.id,
      ok: true,
      value: handle(request),
    };
  } catch (err) {
    response = {
      id: request.id,
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        code: 'query',
      },
    };
  }
  port.postMessage(response);
});
