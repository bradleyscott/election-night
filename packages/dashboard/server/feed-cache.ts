/**
 * Reading and writing the dashboard server's persisted feed-event cache.
 *
 * The feed cache is tagged with the election cycle for the same reason the
 * results cache is (`results-cache.ts`): the Fly volume outlives a cycle, so an
 * untagged file lets one election's feed events be preloaded and served as the
 * next election's. The dashboard would then open on a finished cycle's
 * commentary with no live count behind it.
 *
 * The rule lives here rather than in `feed.ts` so it is testable without
 * booting the server or touching a volume.
 */

import type { FeedEvent } from '@election-night/core/types';

export type CachedFeedFile = {
  electionYear: string;
  events: FeedEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extract feed events from a cache file's raw contents.
 *
 * Returns `null` when there is nothing safe to use, which leaves the feed empty
 * until a scrape produces events. An untagged (pre-tag) array is only accepted
 * when the caller does not know which cycle it is serving — otherwise it cannot
 * be attributed to a cycle and is skipped.
 */
export function extractCachedFeedEvents(
  raw: string,
  expectedYear?: string
): FeedEvent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    return expectedYear === undefined ? (parsed as FeedEvent[]) : null;
  }

  if (!isRecord(parsed)) return null;
  if (!Array.isArray(parsed.events)) return null;
  if (typeof parsed.electionYear !== 'string') return null;
  if (expectedYear !== undefined && parsed.electionYear !== expectedYear) {
    return null;
  }

  return parsed.events as FeedEvent[];
}

/**
 * Explain why a cache was skipped, for the operator reading the log. Returns
 * `null` when there is nothing to explain (the cache is usable).
 */
export function describeFeedCacheSkip(
  raw: string,
  expectedYear?: string
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'feed cache file is not valid JSON';
  }

  if (Array.isArray(parsed)) {
    return expectedYear === undefined
      ? null
      : 'feed cache has no election year and the server is serving a known cycle';
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
    return 'feed cache is not a feed-event payload';
  }
  if (typeof parsed.electionYear !== 'string') {
    return 'feed cache has no election year';
  }
  return `feed cache belongs to the ${parsed.electionYear} election, not ${expectedYear}`;
}

/**
 * Serialise feed events for disk, tagged with the cycle when the server knows
 * which one it serves. With no `ELECTION_YEAR` there is no honest tag to write,
 * so the legacy bare array is kept and the reader applies the same rule.
 */
export function serializeFeedEvents(
  events: FeedEvent[],
  electionYear?: string
): string {
  const payload: CachedFeedFile | FeedEvent[] = electionYear
    ? { electionYear, events }
    : events;
  return JSON.stringify(payload, null, 2);
}
