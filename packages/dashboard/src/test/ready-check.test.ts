import { describe, it, expect } from 'vitest';
import {
  collectorStatus,
  evaluateReady,
} from '../../server/ready-check.js';

describe('collectorStatus', () => {
  it('is disabled when the collector is turned off', () => {
    expect(
      collectorStatus({ enabled: false, cycleCount: 0, lastCycleOk: false })
    ).toBe('disabled');
  });

  it('is starting before the first cycle completes', () => {
    expect(
      collectorStatus({ enabled: true, cycleCount: 0, lastCycleOk: false })
    ).toBe('starting');
  });

  it('is ok once a cycle has succeeded', () => {
    expect(
      collectorStatus({ enabled: true, cycleCount: 3, lastCycleOk: true })
    ).toBe('ok');
  });

  it('is error when the last cycle failed', () => {
    expect(
      collectorStatus({ enabled: true, cycleCount: 3, lastCycleOk: false })
    ).toBe('error');
  });
});

describe('evaluateReady', () => {
  it('is ready while the collector is starting — but reports not-ok', () => {
    expect(
      evaluateReady({
        historyAvailable: false,
        collector: 'starting',
        lastScrape: 'none',
      })
    ).toEqual({
      ready: false,
      checks: { collector: 'starting', history: 'unavailable', lastScrape: 'none' },
    });
  });

  it('is ready once the collector has completed a cycle', () => {
    expect(
      evaluateReady({
        historyAvailable: true,
        collector: 'ok',
        lastScrape: 12345,
      })
    ).toEqual({
      ready: true,
      checks: { collector: 'ok', history: 'ok', lastScrape: 12345 },
    });
  });

  it('is not ready when the collector is failing', () => {
    expect(
      evaluateReady({
        historyAvailable: true,
        collector: 'error',
        lastScrape: 67890,
      }).ready
    ).toBe(false);
  });

  /**
   * A dashboard-only node never polls the feed, so it has nothing to wait for
   * and must be routable immediately — this is the PR-preview shape, which
   * previously reported not-ready forever because of the dead history hop.
   */
  it('is ready for a dashboard-only node even with no history', () => {
    expect(
      evaluateReady({
        historyAvailable: false,
        collector: 'disabled',
        lastScrape: 'none',
      })
    ).toEqual({
      ready: true,
      checks: {
        collector: 'disabled',
        history: 'unavailable',
        lastScrape: 'none',
      },
    });
  });
});
