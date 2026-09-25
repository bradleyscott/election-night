import type { IncomingMessage, ServerResponse } from 'http';
import type { HistorySource } from './history-upstream.js';

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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

  // GET /api/history/snapshots — return all snapshot timestamps
  if (pathname === '/api/history/snapshots') {
    sendJson(res, await historySource.snapshotMetas());
    return true;
  }

  // GET /api/history/electorate/:name — return history for one electorate
  const electorateMatch = pathname.match(/^\/api\/history\/electorate\/(.+)$/);
  if (electorateMatch) {
    const name = decodeURIComponent(electorateMatch[1]);
    sendJson(res, await historySource.electorateHistory(name));
    return true;
  }

  // GET /api/history/party-votes — return party vote totals over time
  if (pathname === '/api/history/party-votes') {
    sendJson(res, await historySource.partyVoteHistory());
    return true;
  }

  // GET /api/history/prior-winners — winners of prior cycles, matched to the
  // current cycle's electorates. 503 when the collector could not derive any
  // (no archive reachable, or a connector that only serves the live cycle).
  if (pathname === '/api/history/prior-winners') {
    const prior = await historySource.priorWinners();
    if (prior) {
      sendJson(res, prior);
    } else {
      sendJson(res, { error: 'prior results unavailable' }, 503);
    }
    return true;
  }

  // GET /api/history/results/:year — results for any nominated cycle, live or
  // archived, from the collector's results service.
  const resultsMatch = pathname.match(/^\/api\/history\/results\/(\d{4})$/);
  if (resultsMatch) {
    const year = resultsMatch[1];
    const results = await historySource.resultsForYear(year);
    if (results) {
      sendJson(res, results);
    } else {
      sendJson(res, { error: `no results available for ${year}` }, 404);
    }
    return true;
  }

  return false;
}
