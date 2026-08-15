import type { IncomingMessage, ServerResponse } from 'http';
import type { HistorySource } from './history-upstream.js';

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
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

  return false;
}
