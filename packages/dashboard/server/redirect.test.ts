import { describe, it, expect } from 'vitest';
import { canonicalRedirect } from './redirect.js';

const canonicalHost = 'example.com';

describe('canonicalRedirect', () => {
  it('does nothing when no canonical host is configured', () => {
    expect(
      canonicalRedirect({
        host: 'www.example.com',
        method: 'GET',
        pathname: '/seats',
      })
    ).toBeNull();
    expect(
      canonicalRedirect({
        host: 'www.example.com',
        method: 'GET',
        pathname: '/seats',
        canonicalHost: '   ',
      })
    ).toBeNull();
  });

  it('redirects www to the apex, keeping the path and query', () => {
    expect(
      canonicalRedirect({
        host: 'www.example.com',
        method: 'GET',
        pathname: '/electorates',
        search: '?seat=auckland-central&view=party',
        canonicalHost,
      })
    ).toEqual({
      status: 301,
      location:
        'https://example.com/electorates?seat=auckland-central&view=party',
    });
  });

  it('redirects the root path', () => {
    expect(
      canonicalRedirect({
        host: 'www.example.com',
        method: 'GET',
        pathname: '/',
        canonicalHost,
      })
    ).toEqual({ status: 301, location: 'https://example.com/' });
  });

  it('redirects HEAD as well as GET', () => {
    expect(
      canonicalRedirect({
        host: 'www.example.com',
        method: 'HEAD',
        pathname: '/trends',
        canonicalHost,
      })
    ).toEqual({ status: 301, location: 'https://example.com/trends' });
  });

  it('leaves other methods alone', () => {
    // A 301 rewrites POST to GET in browsers, and both hosts serve the same
    // app, so an API call is served rather than silently retargeted.
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(
        canonicalRedirect({
          host: 'www.example.com',
          method,
          pathname: '/api/clear',
          canonicalHost,
        })
      ).toBeNull();
    }
  });

  it('serves the apex itself', () => {
    expect(
      canonicalRedirect({
        host: 'example.com',
        method: 'GET',
        pathname: '/',
        canonicalHost,
      })
    ).toBeNull();
  });

  it('leaves unrelated hosts and lookalike subdomains alone', () => {
    for (const host of [
      'example.com',
      'election-night.fly.dev',
      'www.example.com.evil.test',
      'wwwexample.com',
      'api.example.com',
      'www.other-example.com',
      'localhost:3456',
      '127.0.0.1:3456',
    ]) {
      expect(
        canonicalRedirect({
          host,
          method: 'GET',
          pathname: '/',
          canonicalHost,
        })
      ).toBeNull();
    }
  });

  it('normalises case, a trailing root dot and a port', () => {
    for (const host of [
      'WWW.Example.COM',
      'www.example.com.',
      'www.example.com:443',
    ]) {
      expect(
        canonicalRedirect({
          host,
          method: 'GET',
          pathname: '/seats',
          canonicalHost,
        })
      ).toEqual({ status: 301, location: 'https://example.com/seats' });
    }
  });

  it('accepts a canonical host pasted with a scheme or trailing slash', () => {
    for (const host of ['https://example.com/', 'HTTPS://Example.com.']) {
      expect(
        canonicalRedirect({
          host: 'www.example.com',
          method: 'GET',
          pathname: '/',
          canonicalHost: host,
        })
      ).toEqual({ status: 301, location: 'https://example.com/' });
    }
  });

  it('does nothing when the request has no host header', () => {
    expect(
      canonicalRedirect({
        host: undefined,
        method: 'GET',
        pathname: '/',
        canonicalHost,
      })
    ).toBeNull();
  });
});
