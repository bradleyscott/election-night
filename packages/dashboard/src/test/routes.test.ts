import { describe, it, expect } from 'vitest';
import { routeLabel } from '../../server/routes.js';

describe('routeLabel', () => {
  it('labels history routes with templates, never raw names', () => {
    expect(routeLabel('/api/history/snapshots')).toBe('/api/history/snapshots');
    expect(routeLabel('/api/history/electorate/Te%20Tai%20Tonga')).toBe(
      '/api/history/electorate/:name'
    );
    expect(routeLabel('/api/history/party-votes')).toBe(
      '/api/history/party-votes'
    );
  });

  it('labels operational endpoints', () => {
    expect(routeLabel('/api/clear')).toBe('/api/clear');
    expect(routeLabel('/health')).toBe('/health');
    expect(routeLabel('/ready')).toBe('/ready');
    expect(routeLabel('/metrics')).toBe('/metrics');
  });

  it('keeps cardinality bounded for static assets and SPA routes', () => {
    expect(routeLabel('/')).toBe('static');
    expect(routeLabel('/assets/index-abc123.js')).toBe('static');
    expect(routeLabel('/electorates/Auckland%20Central')).toBe('static');
  });

  it('groups unrecognised API paths', () => {
    expect(routeLabel('/api/something-else')).toBe('/api/other');
  });
});
