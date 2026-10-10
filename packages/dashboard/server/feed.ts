import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { FeedEvent } from '@election-night/core/types';
import { dashboardServerConfig } from './config.js';
import {
  describeFeedCacheSkip,
  extractCachedFeedEvents,
  serializeFeedEvents,
} from './feed-cache.js';
import { feedEventsTotal, feedEventsStored } from './metrics.js';
import { log } from './logger.js';

export { buildFeedEvents } from './feed-events.js';

const FEED_CACHE_PATH = dashboardServerConfig.feedCachePath;
const MAX_FEED_EVENTS = dashboardServerConfig.maxFeedEvents;

let feedEvents: FeedEvent[] = [];

export function currentFeedEvents(): FeedEvent[] {
  return feedEvents;
}

/** Load persisted feed events from disk into module state. */
export function loadFeedEvents(): void {
  feedEvents = readFeedEventsFromDisk();
  feedEventsStored.set(feedEvents.length);
}

/**
 * Load the cached feed events for the cycle being served. A cache tagged with
 * another election is ignored rather than presented as this cycle's feed: the
 * volume outlives a cycle, so without the check a finished cycle's commentary
 * would open the next one's feed. A cache that cannot be attributed to a cycle
 * (an untagged pre-tag file) is only read when `ELECTION_YEAR` is unset.
 */
function readFeedEventsFromDisk(): FeedEvent[] {
  if (!existsSync(FEED_CACHE_PATH)) return [];
  const expectedYear = dashboardServerConfig.electionYear;
  try {
    const raw = readFileSync(FEED_CACHE_PATH, 'utf-8');
    const events = extractCachedFeedEvents(raw, expectedYear);
    if (events) return events;
    log.warn(
      `Ignoring feed cache at ${FEED_CACHE_PATH}: ${describeFeedCacheSkip(raw, expectedYear)}`
    );
  } catch (err) {
    log.error('Failed to load cached feed events:', err);
  }
  return [];
}

export function resetFeedState(): void {
  feedEvents = [];
  feedEventsStored.set(0);
}

function saveFeedEvents(events: FeedEvent[]) {
  try {
    mkdirSync(dirname(FEED_CACHE_PATH), { recursive: true });
    writeFileSync(
      FEED_CACHE_PATH,
      serializeFeedEvents(events, dashboardServerConfig.electionYear)
    );
  } catch (err) {
    log.error('Failed to save feed events:', err);
  }
}

/**
 * Append events to the in-memory list (deduplicating by id), persist, and
 * return only the genuinely new ones for broadcast.
 */
export function addFeedEvents(events: FeedEvent[]): FeedEvent[] {
  const existingIds = new Set(feedEvents.map((e) => e.id));
  const newEvents = events.filter((e) => !existingIds.has(e.id));
  if (newEvents.length === 0) return newEvents;
  feedEvents = [...feedEvents, ...newEvents].slice(-MAX_FEED_EVENTS);
  feedEventsStored.set(feedEvents.length);
  newEvents.forEach((event) => feedEventsTotal.inc({ type: event.type }));
  saveFeedEvents(feedEvents);
  return newEvents;
}
