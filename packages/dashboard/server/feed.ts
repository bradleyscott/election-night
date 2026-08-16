import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { FeedEvent } from '@election-night/core/types';
import { dashboardServerConfig } from './config.js';
import { feedEventsTotal } from './metrics.js';
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
}

function readFeedEventsFromDisk(): FeedEvent[] {
  if (!existsSync(FEED_CACHE_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(FEED_CACHE_PATH, 'utf-8'));
    if (Array.isArray(data)) return data as FeedEvent[];
  } catch (err) {
    log.error('Failed to load cached feed events:', err);
  }
  return [];
}

export function resetFeedState(): void {
  feedEvents = [];
}

function saveFeedEvents(events: FeedEvent[]) {
  try {
    mkdirSync(dirname(FEED_CACHE_PATH), { recursive: true });
    writeFileSync(FEED_CACHE_PATH, JSON.stringify(events, null, 2));
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
  newEvents.forEach((event) => feedEventsTotal.inc({ type: event.type }));
  saveFeedEvents(feedEvents);
  return newEvents;
}
