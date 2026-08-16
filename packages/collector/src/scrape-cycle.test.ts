import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { scrapeCycle } from './scrape-cycle.js';
import type { BrowserContext } from 'playwright-core';
import type { ElectionSource, ElectorateConfig } from '@election-night/core/types';

const mockGetElectoratePageHtml = vi.fn();
const mockIsCloudflareChallenge = vi.fn();
const mockReadResults = vi.fn();
const mockPublishMetrics = vi.fn();

vi.mock('./scraper.js', () => ({
  getElectoratePageHtml: (...args: unknown[]) => mockGetElectoratePageHtml(...args),
  isCloudflareChallenge: (...args: unknown[]) => mockIsCloudflareChallenge(...args),
}));

vi.mock('./results.js', () => ({
  readResults: () => mockReadResults(),
}));

vi.mock('./ws-client.js', () => ({
  publishMetrics: (...args: unknown[]) => mockPublishMetrics(...args),
}));

describe('scrapeCycle', () => {
  beforeEach(() => {
    mockGetElectoratePageHtml.mockReset();
    mockIsCloudflareChallenge.mockReset();
    mockReadResults.mockReset();
    mockPublishMetrics.mockReset();
    mockReadResults.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('treats a Cloudflare challenge page as a failed fetch and falls back to cached results', async () => {
    const config: ElectorateConfig = {
      electorateName: 'Auckland Central',
      url: 'https://example.test/electorate-details-01.html',
    };

    mockGetElectoratePageHtml.mockResolvedValue('<html>challenge</html>');
    mockIsCloudflareChallenge.mockReturnValue(true);

    const source: ElectionSource = {
      getElectorateConfigs: () => [config],
      parseRawResults: vi.fn().mockReturnValue({
        electorateName: 'Auckland Central',
        candidateVotes: [{ candidate: 'Alice', votes: 1000 }],
        partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
        votesCounted: 1000,
        votePercentageCounted: 0.5,
      }),
    };

    const payload = await scrapeCycle({
      context: {} as BrowserContext,
      source,
      configs: [config],
      candidateRecords: [],
      partyMap: {},
      partyListRecords: [],
      concurrency: 1,
    });

    expect(mockGetElectoratePageHtml).toHaveBeenCalledWith(
      expect.anything(),
      config
    );
    expect(source.parseRawResults).not.toHaveBeenCalled();
    expect(payload.electorateResults).toHaveLength(0);
  });

  test('parses real pages that are not challenge pages', async () => {
    const config: ElectorateConfig = {
      electorateName: 'Auckland Central',
      url: 'https://example.test/electorate-details-01.html',
    };

    mockGetElectoratePageHtml.mockResolvedValue('<html>real results</html>');
    mockIsCloudflareChallenge.mockReturnValue(false);

    const source: ElectionSource = {
      getElectorateConfigs: () => [config],
      parseRawResults: vi.fn().mockReturnValue({
        electorateName: 'Auckland Central',
        candidateVotes: [{ candidate: 'Alice', votes: 1000 }],
        partyVotes: [{ candidate: 'Red Party', votes: 1000 }],
        votesCounted: 1000,
        votePercentageCounted: 0.5,
      }),
    };

    const payload = await scrapeCycle({
      context: {} as BrowserContext,
      source,
      configs: [config],
      candidateRecords: [{ Name: 'Alice', Party: 'Red Party' }],
      partyMap: { Alice: 'Red Party' },
      partyListRecords: [],
      concurrency: 1,
    });

    expect(source.parseRawResults).toHaveBeenCalledWith(
      '<html>real results</html>',
      config
    );
    expect(payload.electorateResults).toHaveLength(1);
    expect(payload.electorateResults[0].electorateName).toBe('Auckland Central');
  });
});
