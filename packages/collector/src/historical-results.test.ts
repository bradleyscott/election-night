import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * `createSourceForYear` decides which cycles this collector can answer at all,
 * so it carries a design decision rather than a detail: the mock override
 * replays one cycle and must never be read as a past election, while the
 * archive *is* the past election and needs no override.
 *
 * The config is parsed once at import time, so each case loads a fresh module
 * graph with its own environment.
 */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const config = await import('./config.js');
  const module = await import('./historical-results.js');
  return {
    config: config.collectorConfig,
    createSourceForYear: module.createSourceForYear,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('createSourceForYear', () => {
  test('serves the live cycle from the override and every prior year from the archive', async () => {
    const { createSourceForYear } = await loadWith({
      ELECTION_YEAR: '2026',
      XML_FEED_BASE_URL: 'http://localhost:3457/',
    });

    expect(createSourceForYear('2026')).not.toBeNull();
    // The archive answers for 2023 even though tonight's feed is a mock. A
    // mocked run that reports prior years unavailable leaves /flipped blank
    // for no good reason — the archive has the real winners.
    expect(createSourceForYear('2023')).not.toBeNull();
    expect(createSourceForYear('2020')).not.toBeNull();
  });

  test('reports prior years unavailable when prior results are switched off', async () => {
    const { createSourceForYear } = await loadWith({
      ELECTION_YEAR: '2026',
      XML_FEED_BASE_URL: 'http://localhost:3457/',
      PRIOR_RESULTS: 'off',
    });

    expect(createSourceForYear('2026')).not.toBeNull();
    expect(createSourceForYear('2023')).toBeNull();
  });

  test('stays on by default and still distinguishes the live cycle', async () => {
    const { config, createSourceForYear } = await loadWith({
      ELECTION_YEAR: '2026',
    });

    expect(config.priorResults).toBe('on');
    expect(createSourceForYear('2026')).not.toBeNull();
    expect(createSourceForYear('2023')).not.toBeNull();
  });
});
