import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import type { ElectionResultsService } from '@election-night/core/election-results-service';
import type { VotingPlaceStatusService } from './voting-place-status.js';
import {
  DEFAULT_HISTORY_MAX_SNAPSHOTS,
  DEFAULT_HISTORY_WINDOW_HOURS,
  queryElectorateHistory,
  queryLatestState,
  queryPartyVoteHistory,
  querySnapshotMetas,
  type HistoryPageRequest,
  type HistoryReader,
} from './history-queries.js';
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
  /**
   * Async read side owned by the SQLite worker. When present the handler never
   * opens a connection on the HTTP thread; the direct read path exists for
   * tests and tools that already hold a handle.
   */
  reader?: HistoryReader;
  /**
   * Trailing window for DB-backed history. Defaults to 24h, matching the
   * collector's retention default; a snapshot older than this is not part of
   * the live charts even if a volume still holds it.
   */
  windowHours?: number;
  /**
   * Hard cap on snapshots returned in one response. A 60s poll yields 1,440
   * in 24h. When the window holds more, the caller must page explicitly rather
   * than receive a silently truncated array.
   */
  maxSnapshots?: number;
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

function sendJson(
  res: ServerResponse,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
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

export interface HistoryPaging {
  request: HistoryPageRequest;
  /** True when the caller asked for a specific limit or offset. */
  explicit: boolean;
  maxSnapshots: number;
}

export type PagingParse =
  { ok: true; paging: HistoryPaging } | { ok: false; error: string };

/**
 * Parse `?limit=` / `?offset=` into a bounded page request.
 *
 * `limit` is capped by `maxSnapshots` so one request cannot ask for the whole
 * table. Values that are not positive integers are rejected explicitly rather
 * than coerced, because a typo that silently becomes the default is the class
 * of bug this endpoint is trying to remove.
 */
export function parseHistoryPaging(
  params: URLSearchParams,
  options: { windowHours: number; maxSnapshots: number }
): PagingParse {
  const rawLimit = params.get('limit');
  const rawOffset = params.get('offset');
  const rawSince = params.get('sinceRevision');

  let limit = options.maxSnapshots;
  let offset = 0;
  let sinceRevision: number | undefined;

  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      return { ok: false, error: 'limit must be a positive integer' };
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > options.maxSnapshots) {
      return {
        ok: false,
        error: `limit must be between 1 and ${options.maxSnapshots}`,
      };
    }
  }

  if (rawOffset !== null) {
    if (!/^\d+$/.test(rawOffset)) {
      return { ok: false, error: 'offset must be a non-negative integer' };
    }
    offset = Number(rawOffset);
  }

  if (rawSince !== null) {
    if (!/^\d+$/.test(rawSince)) {
      return {
        ok: false,
        error: 'sinceRevision must be a non-negative integer',
      };
    }
    sinceRevision = Number(rawSince);
  }

  return {
    ok: true,
    paging: {
      request: {
        windowHours: options.windowHours,
        limit,
        offset,
        sinceRevision,
      },
      explicit: rawLimit !== null || rawOffset !== null,
      maxSnapshots: options.maxSnapshots,
    },
  };
}

function pageHeaders(
  total: number,
  paging: HistoryPaging
): Record<string, string> {
  return {
    'x-history-total': String(total),
    'x-history-limit': String(paging.request.limit),
    'x-history-offset': String(paging.request.offset),
    'x-history-window-hours': String(paging.request.windowHours),
  };
}

/**
 * Send a page, or refuse explicitly when it would truncate.
 *
 * An unpaged request whose window exceeds the cap gets a 413 that names the
 * total and the cap. Returning the first N rows with a `200` would make the
 * chart look complete while silently dropping the rest.
 */
function sendPage<T>(
  res: ServerResponse,
  page: { rows: T[]; total: number },
  paging: HistoryPaging
): void {
  const headers = pageHeaders(page.total, paging);
  const revisions = page.rows
    .map((row) => (row as { revision?: number | null }).revision)
    .filter((value): value is number => typeof value === 'number');
  if (revisions.length > 0) {
    headers['x-history-revision'] = String(Math.max(...revisions));
  }
  if (!paging.explicit && page.total > paging.maxSnapshots) {
    sendJson(
      res,
      {
        error: 'history window exceeds the maximum page size',
        total: page.total,
        limit: paging.maxSnapshots,
        windowHours: paging.request.windowHours,
      },
      413,
      headers
    );
    return;
  }
  sendJson(res, page.rows, 200, headers);
}

/** A worker client refuses requests while the database is unavailable. */
function isUnavailableError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'unavailable'
  );
}

/**
 * DB-backed routes when a worker owns the connection. The handler awaits the
 * worker's bounded read, so a slow database delays this response but not the
 * event loop or `/health`.
 */
async function serveReaderRoutes(
  res: ServerResponse,
  pathname: string,
  params: URLSearchParams,
  reader: HistoryReader,
  configuredYear: string | undefined,
  windowHours: number,
  maxSnapshots: number
): Promise<boolean> {
  const year = params.get('year') ?? configuredYear;
  if (!year) {
    sendJson(res, { error: 'no election year configured' }, 503);
    return true;
  }

  const parsedPaging = parseHistoryPaging(params, {
    windowHours,
    maxSnapshots,
  });
  if (!parsedPaging.ok) {
    sendJson(res, { error: parsedPaging.error }, 400);
    return true;
  }
  const paging = parsedPaging.paging;

  try {
    if (pathname === '/history/latest') {
      const latest = await reader.latest(year);
      if (!latest) {
        sendJson(res, { error: 'no latest state' }, 404);
        return true;
      }
      sendJson(res, latest, 200, {
        'x-election-revision': String(latest.revision),
      });
      return true;
    }

    if (pathname === '/history/snapshots') {
      sendPage(res, await reader.snapshots(year, paging.request), paging);
      return true;
    }

    const electorateMatch = pathname.match(/^\/history\/electorate\/(.+)$/);
    if (electorateMatch) {
      sendPage(
        res,
        await reader.electorate(
          decodeURIComponent(electorateMatch[1]!),
          year,
          paging.request
        ),
        paging
      );
      return true;
    }

    if (pathname === '/history/party-votes') {
      sendPage(res, await reader.partyVotes(year, paging.request), paging);
      return true;
    }
  } catch (err) {
    if (isUnavailableError(err)) {
      // The worker is dead, its queue is full, or a read timed out. Say so;
      // never answer an empty successful count.
      sendJson(res, { error: 'database unavailable' }, 503);
      return true;
    }
    log.error('History API query failed', err);
    sendJson(res, { error: 'query failed' }, 500);
    return true;
  }

  sendJson(res, { error: 'not found' }, 404);
  return true;
}

/**
 * Route handler mounted into the health server. Returns true when the request
 * was handled (including auth failures); false to fall through to 404.
 */
export function createHistoryHandler(
  options: HistoryHandlerOptions
): (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean> {
  const {
    dbPath,
    electionYear,
    resultsService,
    votingPlaces,
    reader,
    windowHours = DEFAULT_HISTORY_WINDOW_HOURS,
    maxSnapshots = DEFAULT_HISTORY_MAX_SNAPSHOTS,
  } = options;

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

    const params = new URLSearchParams(query ?? '');

    if (reader) {
      return serveReaderRoutes(
        res,
        pathname!,
        params,
        reader,
        electionYear,
        windowHours,
        maxSnapshots
      );
    }

    const handle = getDb(dbPath);
    if (!handle) {
      sendJson(res, { error: 'database not available yet' }, 503);
      return true;
    }

    const requestedYear = params.get('year');
    const year = resolveElectionYear(handle, requestedYear, electionYear);
    if (pathname === '/history/latest') {
      if (!year) {
        sendJson(res, { error: 'no latest state' }, 404);
        return true;
      }
      const latest = queryLatestState(handle, year);
      if (!latest) {
        sendJson(res, { error: 'no latest state' }, 404);
        return true;
      }
      sendJson(res, latest, 200, {
        'x-election-revision': String(latest.revision),
      });
      return true;
    }
    if (!year) {
      sendJson(res, [], 200, {
        'x-history-total': '0',
        'x-history-window-hours': String(windowHours),
      });
      return true;
    }

    const parsedPaging = parseHistoryPaging(params, {
      windowHours,
      maxSnapshots,
    });
    if (!parsedPaging.ok) {
      sendJson(res, { error: parsedPaging.error }, 400);
      return true;
    }
    const paging = parsedPaging.paging;

    try {
      if (pathname === '/history/snapshots') {
        sendPage(res, querySnapshotMetas(handle, year, paging.request), paging);
        return true;
      }
      const electorateMatch = pathname!.match(/^\/history\/electorate\/(.+)$/);
      if (electorateMatch) {
        sendPage(
          res,
          queryElectorateHistory(
            handle,
            decodeURIComponent(electorateMatch[1]!),
            year,
            paging.request
          ),
          paging
        );
        return true;
      }
      if (pathname === '/history/party-votes') {
        sendPage(
          res,
          queryPartyVoteHistory(handle, year, paging.request),
          paging
        );
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
