/**
 * Map a request path to a bounded Prometheus `route` label value.
 *
 * Raw paths must never become label values: `/api/history/electorate/:name`
 * alone covers every electorate, and static asset paths would create a series
 * per file. Anything unrecognised collapses to `static`.
 */
export function routeLabel(pathname: string): string {
  if (pathname === '/api/clear') return '/api/clear';
  if (pathname === '/api/history/snapshots') return '/api/history/snapshots';
  if (pathname.startsWith('/api/history/electorate/')) {
    return '/api/history/electorate/:name';
  }
  if (pathname === '/api/history/party-votes')
    return '/api/history/party-votes';
  if (pathname === '/health') return '/health';
  if (pathname === '/ready') return '/ready';
  if (pathname === '/metrics') return '/metrics';
  if (pathname.startsWith('/api/')) return '/api/other';
  if (pathname.startsWith('/socket.io/')) return '/socket.io';
  return 'static';
}
