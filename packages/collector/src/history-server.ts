import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { log } from './logger.js';

/**
 * History REST endpoints served from the collector's SQLite DB, mounted on
 * the health server's port (3459). This is the *only* source of history
 * data: the dashboard server never opens a SQLite DB, it always fetches
 * from here — co-located processes over loopback, split deployments over
 * TLS + bearer token.
 *
 * Safe by default: loopback peers are trusted; remote callers need
 * `HISTORY_TOKEN` (404 when unset, 401 when wrong).
 */

export interface HistoryHandlerOptions {
  dbPath: string;
  /** Bearer token required by non-loopback callers; loopback is trusted. */
  token: string | undefined;
}

let db: Database.Database | null = null;
let dbPath: string | undefined;

function getDb(path: string): Database.Database | null {
  if (db && dbPath === path) return db;
  // Path changed (or first call): reopen. The DB file is created by the first
  // scrape cycle, so while it's missing we retry cheaply on each request.
  if (db) {
    db.close();
    db = null;
  }
  dbPath = path;
  if (!existsSync(path)) return null;
  db = new Database(path, { readonly: true });
  db.pragma('journal_mode = WAL');
  log.info(`History API serving DB (read-only) at ${path}`);
  return db;
}

export function closeHistoryDb(): void {
  if (db) db.close();
  db = null;
  dbPath = undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Loopback peers (dev, all-in-one image) are trusted without a token. */
function isLoopback(remoteAddress: string): boolean {
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

/** Pure auth decision, exported for testing. */
export function authorizeHistoryRequest(
  remoteAddress: string,
  authorization: string | undefined,
  token: string | undefined
): 'allow' | 'unauthorized' | 'not-found' {
  const loopback = isLoopback(remoteAddress);
  if (!token) return loopback ? 'allow' : 'not-found';
  if (loopback) return 'allow';
  return authorization === `Bearer ${token}` ? 'allow' : 'unauthorized';
}

function getSnapshotMetas(handle: Database.Database): unknown[] {
  return handle
    .prepare(
      `SELECT id AS snapshotId, started_at AS startedAt, completed_at AS completedAt
       FROM scrape_snapshots
       ORDER BY started_at ASC`
    )
    .all();
}

function getElectorateHistory(
  handle: Database.Database,
  name: string
): unknown[] {
  const summaries = handle
    .prepare(
      `SELECT
         ss.id AS snapshotId,
         ss.started_at AS startedAt,
         ss.completed_at AS completedAt,
         es.votes_counted AS votesCounted,
         es.vote_pct_counted AS votePctCounted,
         es.leading_candidate AS leadingCandidate,
         es.leading_party AS leadingParty,
         es.predicted_winner AS predictedWinner,
         es.margin AS margin,
         es.margin_pct AS marginPct,
         es.margin_of_error AS marginOfError
       FROM scrape_snapshots ss
       JOIN electorate_summary es ON es.scrape_id = ss.id
       WHERE es.electorate = ?
       ORDER BY ss.started_at ASC`
    )
    .all(name) as Record<string, unknown>[];

  return summaries.map((row) => ({
    ...row,
    candidates: handle
      .prepare(
        `SELECT candidate, party, votes, is_predicted AS isPredicted
         FROM electorate_results
         WHERE scrape_id = ? AND electorate = ?
         ORDER BY votes DESC`
      )
      .all(row.snapshotId, name),
    partyVotes: handle
      .prepare(
        `SELECT party, votes
         FROM party_vote_results
         WHERE scrape_id = ? AND electorate = ?
         ORDER BY votes DESC`
      )
      .all(row.snapshotId, name),
  }));
}

function getPartyVoteHistory(handle: Database.Database): unknown[] {
  const snapshots = handle
    .prepare(
      `SELECT id AS snapshotId, started_at AS startedAt, completed_at AS completedAt
       FROM scrape_snapshots
       ORDER BY started_at ASC`
    )
    .all() as Record<string, unknown>[];

  return snapshots.map((snap) => {
    const sid = snap.snapshotId as number;
    const parties = handle
      .prepare(
        `SELECT party, votes, seats, electorate_seats AS electorateSeats, list_seats AS listSeats
         FROM party_vote_summary
         WHERE scrape_id = ?
         ORDER BY votes DESC`
      )
      .all(sid);
    const counted = handle
      .prepare(
        `SELECT COALESCE(SUM(votes_counted), 0) AS votesCounted,
                COALESCE(SUM(estimated_total_votes), 0) AS estimatedTotalVotes
         FROM electorate_summary
         WHERE scrape_id = ?`
      )
      .get(sid) as Record<string, number>;
    return {
      ...snap,
      votesCounted: counted.votesCounted,
      votePctCounted:
        counted.estimatedTotalVotes > 0
          ? counted.votesCounted / counted.estimatedTotalVotes
          : 0,
      parties,
    };
  });
}

/**
 * Route handler mounted into the health server. Returns true when the request
 * was handled (including auth failures); false to fall through to 404.
 */
export function createHistoryHandler(
  options: HistoryHandlerOptions
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { dbPath, token } = options;

  return (req, res) => {
    const url = req.url ?? '';
    if (!url.startsWith('/history')) return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }

    // Loopback (dev, all-in-one image) is trusted; remote callers need the
    // token — 404 when unset (feature off), 401 when set but wrong.
    const decision = authorizeHistoryRequest(
      req.socket.remoteAddress ?? '',
      req.headers.authorization,
      token
    );
    if (decision !== 'allow') {
      sendJson(res, decision === 'unauthorized' ? 401 : 404, {
        error: decision === 'unauthorized' ? 'unauthorized' : 'not found',
      });
      return true;
    }

    const handle = getDb(dbPath);
    if (!handle) {
      sendJson(res, 503, { error: 'database not available yet' });
      return true;
    }

    const pathname = url.split('?')[0]!;
    try {
      if (pathname === '/history/snapshots') {
        sendJson(res, 200, getSnapshotMetas(handle));
        return true;
      }
      const electorateMatch = pathname.match(/^\/history\/electorate\/(.+)$/);
      if (electorateMatch) {
        sendJson(
          res,
          200,
          getElectorateHistory(handle, decodeURIComponent(electorateMatch[1]!))
        );
        return true;
      }
      if (pathname === '/history/party-votes') {
        sendJson(res, 200, getPartyVoteHistory(handle));
        return true;
      }
    } catch (err) {
      log.error('History API query failed', err);
      sendJson(res, 500, { error: 'query failed' });
      return true;
    }

    sendJson(res, 404, { error: 'not found' });
    return true;
  };
}
