import type { IncomingMessage, ServerResponse } from 'http';
import type { ResultsDb } from '@election-night/collector';

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Handle `/api/history/*` routes straight from the in-process snapshot DB.
 *
 * `?year=YYYY` browses an archived cycle; without it the configured
 * `ELECTION_YEAR` applies. An unreadable DB yields empty arrays rather than an
 * error — the UI shows its waiting state until the first snapshot lands.
 *
 * Returns false when the pathname is not a history route (so the caller can
 * fall through to static serving).
 */
export function serveApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  resultsDb: ResultsDb
): boolean {
  void req;
  const pathname = url.pathname;
  const year = url.searchParams.get('year') ?? undefined;

  if (pathname === '/api/history/snapshots') {
    sendJson(res, resultsDb.snapshotMetas(year));
    return true;
  }

  const electorateMatch = pathname.match(/^\/api\/history\/electorate\/(.+)$/);
  if (electorateMatch) {
    const name = decodeURIComponent(electorateMatch[1]!);
    sendJson(res, resultsDb.electorateHistory(name, year));
    return true;
  }

  if (pathname === '/api/history/party-votes') {
    sendJson(res, resultsDb.partyVoteHistory(year));
    return true;
  }

  return false;
}
