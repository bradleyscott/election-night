import { describe, it, expect } from 'vitest';
import {
  emitCollectorSocketConnected,
  emitScrapeDuration,
  emitScrapeElectorate,
  emitWebhookPublish,
} from './metrics.js';

describe('collector metric events', () => {
  it('emits scrape duration events', () => {
    expect(emitScrapeDuration(2.5, 'partial')).toEqual({
      metric: 'scrapeDurationSeconds',
      seconds: 2.5,
      status: 'partial',
    });
  });

  it('emits electorate scrape events', () => {
    expect(emitScrapeElectorate('error')).toEqual({
      metric: 'scrapeElectoratesTotal',
      status: 'error',
    });
    expect(emitScrapeElectorate('cached')).toEqual({
      metric: 'scrapeElectoratesTotal',
      status: 'cached',
    });
  });

  it('emits socket connection events', () => {
    expect(emitCollectorSocketConnected(true)).toEqual({
      metric: 'collectorSocketConnected',
      connected: true,
    });
  });

  it('emits webhook publish events', () => {
    expect(emitWebhookPublish('success')).toEqual({
      metric: 'webhookPublishesTotal',
      status: 'success',
    });
  });
});
