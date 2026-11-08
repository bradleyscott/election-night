/**
 * Which publishers the dashboard server accepts results from.
 *
 * In the combined image the collector publishes to `WS_URL`, which is loopback.
 * A socket that reaches the server through Fly's proxy carries the proxy's
 * address, never a loopback one, so this is what separates our collector from a
 * remote one. Accepting a remote publisher means any stray collector on the
 * internet can set the payload every visitor sees, and the wrong cycle outlives
 * a redeploy because the retained payload is re-emitted on connect.
 */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/**
 * Whether a publisher may set the retained results.
 *
 * Loopback is always allowed. A remote publisher is allowed only when the
 * split-deployment flag is on *and* a shared token is configured and matches:
 * `ALLOW_REMOTE_RESULTS=true` by itself is a permission, not an
 * authentication method, and a stray remote collector must not be able to
 * replace every visitor's payload.
 */
export function isAuthorizedPublisher(options: {
  remote: boolean;
  allowRemote: boolean;
  token: string | undefined;
  expectedToken: string | undefined;
}): boolean {
  if (!options.remote) return true;
  if (!options.allowRemote) return false;
  if (!options.expectedToken) return false;
  return options.token === options.expectedToken;
}
