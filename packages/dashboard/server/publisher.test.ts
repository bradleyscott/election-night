import { describe, expect, it } from 'vitest';
import { isLoopbackAddress } from './publisher.js';

describe('isLoopbackAddress', () => {
  it('accepts the collector’s loopback connections', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    // Node reports IPv4 loopback as a mapped address on a dual-stack listener.
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects a publisher that came in through the proxy', () => {
    // Fly's proxy address, and the shape of a remote client's address.
    expect(isLoopbackAddress('fdaa:0:1234:a7b:1a2b:3c4d:5e6f:7a8b')).toBe(
      false
    );
    expect(isLoopbackAddress('66.241.125.134')).toBe(false);
    expect(isLoopbackAddress('::ffff:66.241.125.134')).toBe(false);
  });

  it('rejects an address it cannot see', () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });
});
