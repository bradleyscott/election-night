import { describe, expect, test } from 'vitest';
import {
  describeCacheSkip,
  extractCachedElectorates,
} from '../../server/results-cache.js';

const tagged = (year: string, results: unknown[]) =>
  JSON.stringify({ electionYear: year, results });
const legacy = (results: unknown[]) => JSON.stringify(results);

describe('extractCachedElectorates', () => {
  test('reads the cycle-tagged shape the collector writes', () => {
    const raw = tagged('2026', [{ electorateName: 'Kenepuru' }]);
    expect(extractCachedElectorates(raw, '2026')).toEqual([
      { electorateName: 'Kenepuru' },
    ]);
  });

  test('rejects a cache from another cycle', () => {
    // The failure this guards: a 2023 cache preloaded onto a 2026 dashboard.
    const raw = tagged('2023', [{ electorateName: 'Wellington Central' }]);
    expect(extractCachedElectorates(raw, '2026')).toBeNull();
    expect(extractCachedElectorates(raw, '2023')).toHaveLength(1);
  });

  test('accepts a tagged cache when the cycle is unknown', () => {
    const raw = tagged('2023', [{ electorateName: 'Ōtaki' }]);
    expect(extractCachedElectorates(raw)).toHaveLength(1);
  });

  test('skips an untagged legacy array once the cycle is known', () => {
    // An untagged array cannot be attributed to a cycle, so it is only safe
    // when the server does not know which cycle it is serving.
    const raw = legacy([{ electorateName: 'Rongotai' }]);
    expect(extractCachedElectorates(raw, '2026')).toBeNull();
    expect(extractCachedElectorates(raw)).toHaveLength(1);
  });

  test('rejects anything else', () => {
    expect(extractCachedElectorates('not json', '2026')).toBeNull();
    expect(extractCachedElectorates('null', '2026')).toBeNull();
    expect(extractCachedElectorates('"a string"', '2026')).toBeNull();
    expect(extractCachedElectorates('{}', '2026')).toBeNull();
    // Tagged shape but missing the arrays/fields we need.
    expect(
      extractCachedElectorates('{"electionYear":"2026"}', '2026')
    ).toBeNull();
    expect(extractCachedElectorates('{"results":[]}', '2026')).toBeNull();
  });

  test('keeps the tag out of the results it returns', () => {
    // Regression: assigning the whole object as `electorateResults` gives the
    // frontend something that is not an array.
    const out = extractCachedElectorates(tagged('2026', []), '2026');
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('describeCacheSkip', () => {
  test('explains the reason a cache was skipped', () => {
    expect(describeCacheSkip(tagged('2023', []), '2026')).toContain(
      'belongs to the 2023 election'
    );
    expect(describeCacheSkip(legacy([]), '2026')).toContain('no election year');
    expect(describeCacheSkip('nope', '2026')).toContain('not valid JSON');
    expect(describeCacheSkip('{}', '2026')).toContain('not a results payload');
  });

  test('returns null when there is nothing to explain', () => {
    expect(describeCacheSkip(legacy([]))).toBeNull();
  });
});
