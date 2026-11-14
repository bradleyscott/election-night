import { describe, expect, test } from 'vitest';
import {
  buildFeedEventsBody,
  decideFeedRecovery,
  parseFeedEventsBody,
} from './feed-recovery.js';
import type { FeedEvent } from '@election-night/core/types';

function event(id: string, overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id,
    timestamp: 1_792_000_000_000,
    type: 'result_updated',
    electorateName: 'Auckland Central',
    summary: 'Auckland Central counted',
    commentary: 'National leads.',
    diff: {
      electorateName: 'Auckland Central',
      previousVotesCounted: null,
      currentVotesCounted: 24_061,
      previousPercentageCounted: null,
      currentPercentageCounted: 100,
      previousMargin: null,
      currentMargin: 1_200,
      previousMarginPercent: null,
      currentMarginPercent: 5,
      leaderChanged: false,
      previousLeaderName: null,
      previousLeaderParty: null,
    },
    ...overrides,
  };
}

describe('buildFeedEventsBody', () => {
  test('names its cycle and stamps the newest event', () => {
    const body = buildFeedEventsBody([event('a'), event('b')], 2026);

    expect(body.electionYear).toBe('2026');
    expect(body.events).toHaveLength(2);
    expect(body.updatedAt).toBe(new Date(1_792_000_000_000).toISOString());
  });

  test('an empty feed has no stamp', () => {
    expect(buildFeedEventsBody([], '2026')).toMatchObject({
      electionYear: '2026',
      events: [],
      updatedAt: null,
    });
  });
});

describe('parseFeedEventsBody', () => {
  test('round-trips what the endpoint serves', () => {
    const body = buildFeedEventsBody([event('a')], '2026');

    expect(parseFeedEventsBody(JSON.parse(JSON.stringify(body)))).toEqual(body);
  });

  test('refuses a body that would half-render', () => {
    const good = buildFeedEventsBody([event('a')], '2026');

    expect(parseFeedEventsBody(null)).toBeNull();
    expect(parseFeedEventsBody({ ...good, events: 'nope' })).toBeNull();
    expect(
      parseFeedEventsBody({ ...good, events: [{ ...event('a'), summary: 7 }] })
    ).toBeNull();
    expect(
      parseFeedEventsBody({ ...good, events: [{ ...event('a'), type: 'x' }] })
    ).toBeNull();
    expect(
      parseFeedEventsBody({ ...good, events: [event('a')].slice(0, 0) })
    ).toMatchObject({ events: [] });
  });
});

describe('decideFeedRecovery', () => {
  // A preview has no volume and no collector, so the feed is the one panel
  // that can never render without this.
  test('adopts the upstream feed on a machine that holds none', () => {
    const body = buildFeedEventsBody([event('a'), event('b')], '2026');

    expect(
      decideFeedRecovery({ body, configuredYear: '2026', localCount: 0 })
    ).toEqual({ kind: 'adopted', events: body.events });
  });

  test('never overwrites events this process already has', () => {
    const body = buildFeedEventsBody([event('a')], '2026');

    expect(
      decideFeedRecovery({ body, configuredYear: '2026', localCount: 3 })
    ).toEqual({ kind: 'ignored', reason: 'has-local' });
  });

  test('refuses another cycle, an untagged body and an empty one', () => {
    const other = buildFeedEventsBody([event('a')], '2023');
    const untagged = { ...buildFeedEventsBody([event('a')], null) };
    const empty = buildFeedEventsBody([], '2026');

    expect(
      decideFeedRecovery({
        body: other,
        configuredYear: '2026',
        localCount: 0,
      })
    ).toEqual({ kind: 'ignored', reason: 'other-cycle' });
    expect(
      decideFeedRecovery({
        body: untagged,
        configuredYear: '2026',
        localCount: 0,
      })
    ).toEqual({ kind: 'ignored', reason: 'other-cycle' });
    expect(
      decideFeedRecovery({
        body: empty,
        configuredYear: '2026',
        localCount: 0,
      })
    ).toEqual({ kind: 'ignored', reason: 'empty' });
  });

  test('refuses a read that never happened', () => {
    expect(
      decideFeedRecovery({ body: null, configuredYear: '2026', localCount: 0 })
    ).toEqual({ kind: 'ignored', reason: 'invalid' });
  });
});
