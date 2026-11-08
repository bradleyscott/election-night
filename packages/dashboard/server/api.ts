import type { IncomingMessage, ServerResponse } from 'http';
import type { HistoryRead, HistorySource } from './history-upstream.js';

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Mark a history response with how it was obtained. `no-store` keeps a stale or
 * cached answer from outliving its verification in a browser or intermediary,
 * and the two headers let a client tell "verified just now" from "old value
 * served because the collector stopped answering".
 */
function writeHistoryHeaders<T>(
  res: ServerResponse,
  read: HistoryRead<T>
): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Election-History-State', read.state);
  if (read.verifiedAt !== null) {
    res.setHeader(
      'X-Election-History-Verified-At',
      new Date(read.verifiedAt).toISOString()
    );
  }
  if (read.reason) {
    res.setHeader('X-Election-History-Reason', read.reason);
  }
}

/**
 * Answer a history read.
 *
 * - verified/cached/stale with data → 200 and the original JSON body (an array
 *   for the list endpoints, so existing clients do not change).
 * - verified but legitimately absent → 404, for the routes where absence is a
 *   normal answer (an archive year, a cycle with no voting-place listing).
 * - unavailable → structured 503. A collector 503 is *not* an empty count.
 */
function sendHistory<T>(
  res: ServerResponse,
  read: HistoryRead<T>,
  options: { error: string; allowMissing?: boolean } = { error: 'unavailable' }
): void {
  writeHistoryHeaders(res, read);

  if (read.unavailable) {
    sendJson(
      res,
      {
        error: options.error,
        state: read.state,
        verifiedAt:
          read.verifiedAt === null
            ? null
            : new Date(read.verifiedAt).toISOString(),
        reason: read.reason ?? null,
      },
      503
    );
    return;
  }

  if (read.data === null) {
    if (options.allowMissing) {
      sendJson(res, { error: options.error }, 404);
      return;
    }
    // No data but not marked unavailable should not happen; be explicit rather
    // than serialising `null` as if it were a successful list.
    sendJson(res, { error: options.error, reason: read.reason ?? null }, 503);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(read.data));
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Handle `/api/history/*` routes. Returns false when the pathname is not a
 * history route (so the caller can fall through to static serving).
 */
export async function serveApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  historySource: HistorySource
): Promise<boolean> {
  void req;
  const pathname = url.pathname;

  // GET /api/history/electorate/:name — return history for one electorate
  const electorateMatch = pathname.match(/^\/api\/history\/electorate\/(.+)$/);
  if (electorateMatch) {
    const name = decodeParam(electorateMatch[1]);
    sendHistory(res, await historySource.electorateHistory(name), {
      error: `history unavailable for ${name}`,
    });
    return true;
  }

  // GET /api/history/latest — the authoritative full payload (electorates,
  // parties and lists) for the cycle. 404 before the first commit.
  if (pathname === '/api/history/latest') {
    sendHistory(res, await historySource.latest(), {
      error: 'latest state unavailable',
      allowMissing: true,
    });
    return true;
  }

  // GET /api/history/party-votes — return party vote totals over time
  if (pathname === '/api/history/party-votes') {
    sendHistory(res, await historySource.partyVoteHistory(), {
      error: 'party vote history unavailable',
    });
    return true;
  }

  // GET /api/history/prior-winners — winners of prior cycles, matched to the
  // current cycle's electorates. 503 when the collector could not derive any
  // (no archive reachable, or a connector that only serves the live cycle).
  if (pathname === '/api/history/prior-winners') {
    sendHistory(res, await historySource.priorWinners(), {
      error: 'prior results unavailable',
    });
    return true;
  }

  // GET /api/history/voting-places/:name — which places count towards a seat
  // and which have reported. 404 when the cycle cannot list its places (the
  // archives publish place results but forbid directory listing), which the
  // map treats as "no layer this cycle" rather than an error.
  const votingPlacesMatch = pathname.match(
    /^\/api\/history\/voting-places\/(.+)$/
  );
  if (votingPlacesMatch) {
    const name = decodeParam(votingPlacesMatch[1]);
    sendHistory(res, await historySource.votingPlaces(name), {
      error: `no voting places for ${name}`,
      allowMissing: true,
    });
    return true;
  }

  // GET /api/history/results/:year — results for any nominated cycle, live or
  // archived, from the collector's results service. A year the collector cannot
  // serve is a normal 404 (and is deliberately not cached).
  const resultsMatch = pathname.match(/^\/api\/history\/results\/(\d{4})$/);
  if (resultsMatch) {
    const year = resultsMatch[1];
    sendHistory(res, await historySource.resultsForYear(year), {
      error: `no results available for ${year}`,
      allowMissing: true,
    });
    return true;
  }

  return false;
}
