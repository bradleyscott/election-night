import { describe, it, expect } from 'vitest';
import { evaluateReady } from '../../server/ready-check.js';

describe('serveReady /ready behavior', () => {
  it('returns ready=true when upstream is reachable even without feed events', () => {
    expect(evaluateReady(true, 'none')).toEqual({
      ready: true,
      checks: { history: 'upstream', lastScrape: 'none' },
    });
  });

  it('returns ready=false when upstream is unreachable', () => {
    expect(evaluateReady(false, 'none')).toEqual({
      ready: false,
      checks: { history: 'error', lastScrape: 'none' },
    });
  });

  it('includes the last feed event timestamp when feed events exist', () => {
    expect(evaluateReady(true, 12345)).toEqual({
      ready: true,
      checks: { history: 'upstream', lastScrape: 12345 },
    });
  });

  it('still reports lastScrape when upstream is unreachable', () => {
    expect(evaluateReady(false, 67890)).toEqual({
      ready: false,
      checks: { history: 'error', lastScrape: 67890 },
    });
  });
});
