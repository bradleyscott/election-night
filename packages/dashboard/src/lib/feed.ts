/**
 * The feed's presentational vocabulary: relative times, and how each event
 * type is named and coloured.
 *
 * The style table used to exist twice — once on the feed page and once in the
 * sidebar — and the two disagreed: the same `count_completed` event read
 * "Count Complete" in one place and "Complete" in the other, and each carried
 * its own copy of the colours. One table, so one event has one name.
 */

import type { FeedEventType } from '@election-night/core/types';

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export type FeedEventStyle = {
  /** The type's name, as both surfaces print it. */
  label: string;
  /** The dot's fill, light and dark (the timeline dot and the sidebar's). */
  dot: string;
  /** The halo behind the sidebar's dot, where it sits on a panel. */
  ring: string;
  /** The label's colour on the feed page. */
  text: string;
};

const FEED_EVENT_STYLE: Record<FeedEventType, FeedEventStyle> = {
  result_updated: {
    label: 'Updated',
    dot: 'bg-blue-700 dark:bg-blue-400',
    ring: 'ring-blue-700/20 dark:ring-blue-400/25',
    text: 'text-blue-700 dark:text-blue-400',
  },
  prediction_called: {
    label: 'Prediction',
    dot: 'bg-green-700 dark:bg-green-400',
    ring: 'ring-green-700/20 dark:ring-green-400/25',
    text: 'text-green-700 dark:text-green-400',
  },
  leader_change: {
    label: 'Leader Change',
    dot: 'bg-amber-600 dark:bg-amber-400',
    ring: 'ring-amber-600/25 dark:ring-amber-400/30',
    text: 'text-amber-700 dark:text-amber-400',
  },
  count_completed: {
    label: 'Count Complete',
    dot: 'bg-green-700 dark:bg-green-400',
    ring: 'ring-green-700/20 dark:ring-green-400/25',
    text: 'text-green-700 dark:text-green-400',
  },
};

/**
 * The style for an event type, falling back to `result_updated` for anything
 * the union does not name — a feed cache written by an older build can be
 * preloaded before the first scrape replaces it.
 */
export function feedEventStyle(type: string): FeedEventStyle {
  return (
    FEED_EVENT_STYLE[type as FeedEventType] ?? FEED_EVENT_STYLE.result_updated
  );
}
