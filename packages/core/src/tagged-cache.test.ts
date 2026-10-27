import { describe, expect, test } from 'vitest';
import { readTaggedCache, serializeTaggedCache } from './tagged-cache.js';

type Row = { name: string };

const tagged = (year: string, key: string, items: Row[]) =>
  JSON.stringify({ electionYear: year, [key]: items });

const read = (raw: string, expectedYear?: string) =>
  readTaggedCache<Row>({
    raw,
    key: 'results',
    payloadNoun: 'results',
    expectedYear,
  });

describe('readTaggedCache', () => {
  test('reads the cycle-tagged shape', () => {
    const raw = tagged('2026', 'results', [{ name: 'Kenepuru' }]);
    expect(read(raw, '2026')).toEqual({
      ok: true,
      items: [{ name: 'Kenepuru' }],
      electionYear: '2026',
    });
  });

  test('reads any envelope key the callers use', () => {
    const raw = JSON.stringify({
      electionYear: '2026',
      events: [{ name: 'feed event' }],
    });
    expect(
      readTaggedCache<Row>({
        raw,
        key: 'events',
        payloadNoun: 'feed-event',
        expectedYear: '2026',
      })
    ).toMatchObject({ ok: true, items: [{ name: 'feed event' }] });
  });

  test('rejects a cache from another cycle', () => {
    // The failure this guards: a 2023 baseline preloaded onto a 2026
    // dashboard, which turned every seat into a leader change at 7pm.
    const raw = tagged('2023', 'results', [{ name: 'Wellington Central' }]);
    expect(read(raw, '2026')).toEqual({
      ok: false,
      reason: 'belongs to the 2023 election, not 2026',
    });
    expect(read(raw, '2023')).toMatchObject({ ok: true });
  });

  test('accepts a tagged cache when the cycle is unknown', () => {
    const raw = tagged('2023', 'results', [{ name: 'Ōtaki' }]);
    expect(read(raw)).toMatchObject({ ok: true, electionYear: '2023' });
  });

  test('skips an untagged legacy array once the cycle is known', () => {
    // An untagged array cannot be attributed to a cycle, so it is only safe
    // when the caller is not serving a particular one.
    const raw = JSON.stringify([{ name: 'Rongotai' }]);
    expect(read(raw, '2026')).toEqual({
      ok: false,
      reason: 'has no election year and 2026 is the cycle being served',
    });
    expect(read(raw)).toEqual({
      ok: true,
      items: [{ name: 'Rongotai' }],
      electionYear: null,
    });
  });

  test('rejects anything else', () => {
    for (const raw of [
      'not json',
      'null',
      '"a string"',
      '{}',
      '{"results":[]}',
    ])
      expect(read(raw, '2026')).toMatchObject({ ok: false });

    // Tagged shape but missing the fields we need.
    expect(read('{"electionYear":"2026"}', '2026')).toEqual({
      ok: false,
      reason: 'is not a results payload',
    });
    expect(read('{"results":[]}', '2026')).toEqual({
      ok: false,
      reason: 'has no election year',
    });
  });

  test('keeps the tag out of the items it returns', () => {
    // Regression: assigning the whole envelope as `electorateResults` gives the
    // frontend something that is not an array.
    const result = read(tagged('2026', 'results', []), '2026');
    expect(result.ok && Array.isArray(result.items)).toBe(true);
  });

  test('names the payload in the skip reason', () => {
    const feed = readTaggedCache<Row>({
      raw: '{}',
      key: 'events',
      payloadNoun: 'feed-event',
      expectedYear: '2026',
    });
    expect(feed).toEqual({ ok: false, reason: 'is not a feed-event payload' });
  });
});

describe('serializeTaggedCache', () => {
  test('tags the file with the cycle it belongs to', () => {
    const raw = serializeTaggedCache([{ name: 'e1' }], 'events', '2026');
    expect(JSON.parse(raw)).toEqual({
      electionYear: '2026',
      events: [{ name: 'e1' }],
    });
  });

  test('round-trips through the reader', () => {
    const raw = serializeTaggedCache([{ name: 'e1' }], 'events', '2026');
    expect(
      readTaggedCache<Row>({
        raw,
        key: 'events',
        payloadNoun: 'feed-event',
        expectedYear: '2026',
      })
    ).toMatchObject({ ok: true, items: [{ name: 'e1' }] });
  });

  test('writes an untagged array only when the cycle is unknown', () => {
    // No ELECTION_YEAR means there is no honest tag to write; the reader
    // applies the mirror of the same rule.
    const raw = serializeTaggedCache([], 'events', undefined);
    expect(Array.isArray(JSON.parse(raw))).toBe(true);
    expect(
      readTaggedCache<Row>({
        raw,
        key: 'events',
        payloadNoun: 'feed-event',
        expectedYear: '2026',
      })
    ).toMatchObject({ ok: false });
  });
});
