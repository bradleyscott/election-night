import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import type { ElectionResultsService } from '@election-night/core/election-results-service';
import type { VotingPlaceStatusService } from './voting-place-status.js';
import { log } from './logger.js';

/**
 * History REST endpoints served from the collector's SQLite DB, mounted on
 * the health server's port (3459). This is the *only* source of history
 * data: the dashboard server never opens a SQLite DB, it always fetches
 * from here — co-located processes over loopback, split deployments over
 * TLS via a reverse proxy.
 *
 * Two routes are not DB queries: `/history/results/:year` and
 * `/history/prior-winners` are answered from the in-memory
 * `ElectionResultsService` (the live cycle's latest scrape plus archived
 * cycles fetched lazily from the configured connector).
 *
 * The data is public election results, so the endpoints are unauthenticated.
 * Rate limiting is deliberately not implemented here — it belongs at the
 * networking layer (reverse proxy / firewall) in front of the collector.
 */

export interface HistoryHandlerOptions {
  dbPath: string;
  /**
   * Election cycle to serve history for (`ELECTION_YEAR`). Every query is
   * scoped to it so a DB holding more than one cycle — the Fly deployment
   * keeps SQLite on a persistent volume — cannot blend 2023 results into 2026
   * charts. Requests may override it with `?year=YYYY`.
   */
  electionYear?: string;
  /**
   * Serves `/history/results/:year` and `/history/prior-winners` from memory.
   * Absent in tests and any embedding that only wants the DB-backed routes.
   */
  resultsService?: ElectionResultsService;
  /**
   * Serves `/history/voting-places/:electorate` — which places count towards a
   * seat and which have reported. Not a DB query either: the collector fetches
   * it from the feed on demand, because only the cycle being counted can list
   * its places.
   */
  votingPlaces?: VotingPlaceStatusService;
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

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Resolve which cycle to answer for.
 *
 * An explicit `?year=` wins (a UI browsing an archived cycle). Otherwise the
 * configured year is authoritative even when it has no rows yet: substituting
 * another cycle's history would show 2023 trends on a 2026 dashboard before the
 * first scrape lands. Only when no year is configured at all — a dashboard
 * process without `ELECTION_YEAR` — do we fall back to the newest cycle in the
 * DB.
 */
function resolveElectionYear(
  handle: Database.Database,
  requested: string | null,
  configured: string | undefined
): string | null {
  if (requested) return requested;
  if (configured) return configured;

  const newest = handle
    .prepare(
      `SELECT election_year AS year FROM scrape_snapshots
       WHERE election_year IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get() as { year: string } | undefined;

  return newest?.year ?? null;
}

function getSnapshotMetas(
  handle: Database.Database,
  electionYear: string
): unknown[] {
  return handle
    .prepare(
      `SELECT id AS snapshotId, election_year AS electionYear,
              started_at AS startedAt, completed_at AS completedAt
       FROM scrape_snapshots
       WHERE election_year = ?
       ORDER BY started_at ASC`
    )
    .all(electionYear);
}

function getElectorateHistory(
  handle: Database.Database,
  name: string,
  electionYear: string
): unknown[] {
  const summaries = handle
    .prepare(
      `SELECT
         ss.id AS snapshotId,
         ss.election_year AS electionYear,
         ss.started_at AS startedAt,
         ss.completed_at AS completedAt,
         es.votes_counted AS votesCounted,
         es.vote_pct_counted AS votePctCounted,
         es.leading_candidate AS leadingCandidate,
         es.leading_party AS leadingParty,
         es.margin AS margin,
         es.margin_pct AS marginPct
       FROM scrape_snapshots ss
       JOIN electorate_summary es ON es.scrape_id = ss.id
       WHERE es.electorate = ? AND ss.election_year = ?
       ORDER BY ss.started_at ASC`
    )
    .all(name, electionYear) as Record<string, unknown>[];

  return summaries.map((row) => ({
    ...row,
    candidates: handle
      .prepare(
        `SELECT candidate, party, votes
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

function getPartyVoteHistory(
  handle: Database.Database,
  electionYear: string
): unknown[] {
  const snapshots = handle
    .prepare(
      `SELECT id AS snapshotId, election_year AS electionYear,
              started_at AS startedAt, completed_at AS completedAt
       FROM scrape_snapshots
       WHERE election_year = ?
       ORDER BY started_at ASC`
    )
    .all(electionYear) as Record<string, unknown>[];

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
  const { dbPath, electionYear, resultsService, votingPlaces } = options;

  return (req, res) => {
    const url = req.url ?? '';
    if (!url.startsWith('/history')) return false;
    if (req.method !== 'GET') {
      sendJson(res, { error: 'method not allowed' }, 405);
      return true;
    }

    const [pathname, query] = url.split('?');

    // Year-scoped results and prior winners are held in memory by the results
    // service (historical cycles are immutable; the live cycle is pushed in by
    // the scrape loop), so they are answered without touching the DB. The
    // handler stays synchronous: the response is written when the fetch (on
    // first request for a cycle, a couple of seconds) settles.
    if (resultsService) {
      if (pathname === '/history/prior-winners') {
        resultsService.getPriorWinners().then(
          (prior) => sendJson(res, prior),
          (err) => {
            log.error('Prior winners lookup failed', err);
            sendJson(res, { error: 'query failed' }, 500);
          }
        );
        return true;
      }

      const resultsMatch = pathname!.match(/^\/history\/results\/(\d{4})$/);
      if (resultsMatch) {
        const requested = resultsMatch[1]!;
        resultsService.getResults(requested).then(
          (results) =>
            results
              ? sendJson(res, results)
              : sendJson(
                  res,
                  { error: `no results available for ${requested}` },
                  404
                ),
          (err) => {
            log.error(`Results lookup failed for ${requested}`, err);
            sendJson(res, { error: 'query failed' }, 500);
          }
        );
        return true;
      }
    }

    // Per-place count status: fetched from the feed on demand, never from the
    // DB (a place list is ~70 files, too many to hold per poll). Answered
    // before the DB is touched so the dashboard can draw a seat's places before
    // the first snapshot lands.
    if (votingPlaces) {
      const placesMatch = pathname!.match(/^\/history\/voting-places\/(.+)$/);
      if (placesMatch) {
        const name = decodeURIComponent(placesMatch[1]!);
        votingPlaces.placesFor(name).then(
          (places) =>
            places
              ? sendJson(res, places)
              : sendJson(
                  res,
                  {
                    error: `no voting places for ${name} in ${electionYear ?? 'this cycle'}`,
                  },
                  404
                ),
          (err) => {
            log.error(`Voting place lookup failed for ${name}`, err);
            sendJson(res, { error: 'query failed' }, 500);
          }
        );
        return true;
      }
    }

    const handle = getDb(dbPath);
    if (!handle) {
      sendJson(res, { error: 'database not available yet' }, 503);
      return true;
    }

    const requestedYear = new URLSearchParams(query ?? '').get('year');
    const year = resolveElectionYear(handle, requestedYear, electionYear);
    if (!year) {
      sendJson(res, []);
      return true;
    }

    try {
      if (pathname === '/history/snapshots') {
        sendJson(res, getSnapshotMetas(handle, year));
        return true;
      }
      const electorateMatch = pathname!.match(/^\/history\/electorate\/(.+)$/);
      if (electorateMatch) {
        sendJson(
          res,
          getElectorateHistory(
            handle,
            decodeURIComponent(electorateMatch[1]!),
            year
          )
        );
        return true;
      }
      if (pathname === '/history/party-votes') {
        sendJson(res, getPartyVoteHistory(handle, year));
        return true;
      }
    } catch (err) {
      log.error('History API query failed', err);
      sendJson(res, { error: 'query failed' }, 500);
      return true;
    }

    sendJson(res, { error: 'not found' }, 404);
    return true;
  };
}
