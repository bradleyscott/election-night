/**
 * Canonical-host redirect (www → apex).
 *
 * The proxy terminates TLS and routes on SNI/Host but performs no host
 * rewriting, so once both hostnames have certificates, `example.com` and
 * `www.example.com` both serve the app. Setting `CANONICAL_HOST` collapses the
 * www alias onto the canonical host with a permanent redirect; leaving it unset
 * disables the redirect entirely, which is what previews, `.fly.dev` and local
 * development want.
 *
 * Only GET and HEAD are redirected. A 301 makes browsers rewrite a POST to a
 * GET, and both hosts serve the identical app, so there is nothing worth
 * silently retargeting.
 */

export type CanonicalRedirect = {
  status: 301;
  location: string;
};

export function canonicalRedirect(args: {
  host: string | undefined;
  method: string | undefined;
  pathname: string;
  search?: string;
  canonicalHost?: string;
}): CanonicalRedirect | null {
  const canonicalHost = normalizeHost(args.canonicalHost);
  if (!canonicalHost) return null;

  const method = (args.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;

  if (normalizeHost(args.host) !== `www.${canonicalHost}`) return null;

  return {
    status: 301,
    location: `https://${canonicalHost}${args.pathname}${args.search ?? ''}`,
  };
}

/**
 * Lowercase a hostname and drop anything a `Host` header (or a pasted
 * `CANONICAL_HOST` value) may carry besides the name: scheme, path, port and
 * the trailing root dot.
 */
function normalizeHost(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}
