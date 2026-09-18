/**
 * Reading the collector's electorate-results cache.
 *
 * The collector writes this file as its webhook diff baseline, and in the
 * combined deployment the dashboard server reads the *same* file
 * (`RESULTS_CACHE_PATH` and `CACHE_PATH` are both `/data/electorate_results.json`)
 * to show something immediately on boot instead of an empty dashboard.
 *
 * Since the cache is tagged with the election cycle, the dashboard has to
 * understand the tagged shape and must not present a previous cycle's
 * electorates as if they were current. Both rules live here so they are
 * testable without booting the server.
 */

export type CachedResultsFile = {
  electionYear: string;
  results: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extract the electorates from a cache file's raw contents.
 *
 * Returns `null` when there is nothing safe to use, which leaves the dashboard
 * in its "waiting for the first scrape" state. An untagged (pre-2026) cache is
 * only accepted when the caller does not know which cycle it is serving —
 * otherwise it cannot be attributed and is skipped.
 */
export function extractCachedElectorates(
  raw: string,
  expectedYear?: string
): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    return expectedYear === undefined ? parsed : null;
  }

  if (!isRecord(parsed)) return null;
  if (!Array.isArray(parsed.results)) return null;
  if (typeof parsed.electionYear !== 'string') return null;
  if (expectedYear !== undefined && parsed.electionYear !== expectedYear) {
    return null;
  }

  return parsed.results;
}

export function describeCacheSkip(
  raw: string,
  expectedYear?: string
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'cache file is not valid JSON';
  }

  if (Array.isArray(parsed)) {
    return expectedYear === undefined
      ? null
      : 'cache has no election year and the server is serving a known cycle';
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return 'cache is not a results payload';
  }
  if (typeof parsed.electionYear !== 'string') {
    return 'cache has no election year';
  }
  return `cache belongs to the ${parsed.electionYear} election, not ${expectedYear}`;
}
