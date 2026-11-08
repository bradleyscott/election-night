/**
 * Message protocol between the collector's main thread and the SQLite worker.
 *
 * Every request and response is structured-cloneable: no functions, class
 * instances or Drizzle handles cross the boundary. `writeSnapshot` exists for
 * that reason — the old `writeResults` took a `chanceFor` callback, so progress
 * is computed on the caller and sent as plain numbers.
 */

import type {
  LatestStateWrite,
  SnapshotWrite,
  PruneResult,
  WebhookOutboxRow,
  WebhookOutcome,
} from './db.js';
import type {
  ElectorateHistoryRow,
  HistoryPage,
  HistoryPageRequest,
  LatestStateRow,
  PartyVoteHistoryRow,
  SnapshotMetaRow,
} from './history-queries.js';

export type DbRequest =
  | { id: number; type: 'open'; dbPath: string }
  | { id: number; type: 'close' }
  | { id: number; type: 'write'; snapshot: SnapshotWrite }
  | { id: number; type: 'writeLatest'; write: LatestStateWrite }
  | { id: number; type: 'prune'; keepHours: number }
  | { id: number; type: 'compact'; maxPages?: number }
  | { id: number; type: 'webhooksClaim'; limit: number }
  | {
      id: number;
      type: 'webhookComplete';
      webhookId: number;
      outcome: WebhookOutcome;
      nextAttemptAt?: string;
      error?: string | null;
    }
  | { id: number; type: 'webhooksPrune'; maxRows?: number }
  | { id: number; type: 'latest'; electionYear: string }
  | {
      id: number;
      type: 'snapshots';
      electionYear: string;
      page: HistoryPageRequest;
    }
  | {
      id: number;
      type: 'electorate';
      name: string;
      electionYear: string;
      page: HistoryPageRequest;
    }
  | {
      id: number;
      type: 'partyVotes';
      electionYear: string;
      page: HistoryPageRequest;
    };

export type DbRequestType = DbRequest['type'];

export type DbErrorCode = 'query' | 'unavailable';

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { message: string; code: DbErrorCode } };

/** Results keyed by request type, used by the client's typed facade. */
export interface DbResultByType {
  open: null;
  close: null;
  write: number;
  writeLatest: number;
  latest: LatestStateRow | null;
  prune: PruneResult;
  compact: number;
  webhooksClaim: WebhookOutboxRow[];
  webhookComplete: null;
  webhooksPrune: number;
  snapshots: HistoryPage<SnapshotMetaRow>;
  electorate: HistoryPage<ElectorateHistoryRow>;
  partyVotes: HistoryPage<PartyVoteHistoryRow>;
}
