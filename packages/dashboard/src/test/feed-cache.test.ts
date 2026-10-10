import { describe, expect, test } from 'vitest';
import type { FeedEvent } from '@election-night/core/types';
import {
  describeFeedCacheSkip,
  extractCachedFeedEvents,
  serializeFeedEvents,
} from '../../server/feed-cache.js';

function makeEvent(id: string): FeedEvent {
  return {
    id,
    timestamp: 1_790_370_873_234,
    type: 'leader_change',
    electorateName: 'Port Waikato',
    predictionStatus: 'too-close',
    marginOfError: 0,
    summary: 'summary',
    commentary: 'commentary',
    diff: {} as FeedEvent['diff'],
  };
}

const tagged = (year: string, events: FeedEvent[]) =>
  JSON.stringify({ electionYear: year, events });
const legacy = (events: FeedEvent[]) => JSON.stringify(events);

describe('extractCachedFeedEvents', () => {
  test('reads the cycle-tagged shape', () => {
    const raw = tagged('2026', [makeEvent('Kenepuru-1')]);
    expect(extractCachedFeedEvents(raw, '2026')).toHaveLength(1);
  });

  test('rejects a feed cache from another cycle', () => {
    // The failure this guards: the 2023 replay's events opening the 2026 feed.
    // The untagged cache this replaces did exactly that, because the file was a
    // bare array with nothing to attribute it to a cycle.
    const raw = tagged('2023', [makeEvent('Port Waikato-42657-0-too-close')]);
    expect(extractCachedFeedEvents(raw, '2026')).toBeNull();
    expect(extractCachedFeedEvents(raw, '2023')).toHaveLength(1);
  });

  test('accepts a tagged cache when the cycle is unknown', () => {
    expect(extractCachedFeedEvents(tagged('2023', []))).toEqual([]);
  });

  test('skips an untagged legacy array once the cycle is known', () => {
    const raw = legacy([makeEvent('Port Waikato-42657-0-too-close')]);
    expect(extractCachedFeedEvents(raw, '2026')).toBeNull();
    expect(extractCachedFeedEvents(raw)).toHaveLength(1);
  });

  test('rejects anything else', () => {
    expect(extractCachedFeedEvents('not json', '2026')).toBeNull();
    expect(extractCachedFeedEvents('null', '2026')).toBeNull();
    expect(extractCachedFeedEvents('"a string"', '2026')).toBeNull();
    expect(extractCachedFeedEvents('{}', '2026')).toBeNull();
    // Tagged shape but missing the fields we need.
    expect(
      extractCachedFeedEvents('{"electionYear":"2026"}', '2026')
    ).toBeNull();
    expect(extractCachedFeedEvents('{"events":[]}', '2026')).toBeNull();
  });
});

describe('serializeFeedEvents', () => {
  test('tags the file with the cycle it belongs to', () => {
    const raw = serializeFeedEvents([makeEvent('e1')], '2026');
    expect(JSON.parse(raw)).toMatchObject({ electionYear: '2026' });
    // Round-trips through the reader.
    expect(extractCachedFeedEvents(raw, '2026')).toHaveLength(1);
  });

  test('writes an untagged array only when the cycle is unknown', () => {
    // No ELECTION_YEAR means there is no honest tag to write; the reader
    // applies the mirror of the same rule.
    expect(Array.isArray(JSON.parse(serializeFeedEvents([], undefined)))).toBe(
      true
    );
    expect(
      extractCachedFeedEvents(serializeFeedEvents([], undefined), '2026')
    ).toBeNull();
  });
});

describe('describeFeedCacheSkip', () => {
  test('explains the reason a cache was skipped', () => {
    expect(describeFeedCacheSkip(tagged('2023', []), '2026')).toContain(
      'belongs to the 2023 election'
    );
    expect(describeFeedCacheSkip(legacy([]), '2026')).toContain(
      'no election year'
    );
    expect(describeFeedCacheSkip('nope', '2026')).toContain('not valid JSON');
    expect(describeFeedCacheSkip('{}', '2026')).toContain(
      'not a feed-event payload'
    );
  });

  test('returns null when there is nothing to explain', () => {
    expect(describeFeedCacheSkip(legacy([]))).toBeNull();
  });
});
