import { describe, expect, test } from 'vitest';
import { MAX_POLL_JITTER_MS, nextPollDelay } from './poll-delay.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('nextPollDelay', () => {
  test('keeps a one-minute interval within ±20%', () => {
    // ±12s of a 60s interval: unchanged by the cap, which is the point of it.
    expect(nextPollDelay(MINUTE, () => 0)).toBe(48_000);
    expect(nextPollDelay(MINUTE, () => 0.5)).toBe(60_000);
    expect(nextPollDelay(MINUTE, () => 0.999_999)).toBe(72_000);
  });

  test('caps the swing at five minutes for a daily interval', () => {
    expect(nextPollDelay(DAY, () => 0)).toBe(DAY - MAX_POLL_JITTER_MS);
    expect(nextPollDelay(DAY, () => 0.5)).toBe(DAY);
    // Math.random() never returns 1, so the top of the range is approached to
    // within rounding rather than hit exactly.
    const highest = nextPollDelay(DAY, () => 0.999_999);
    expect(highest).toBeGreaterThan(DAY + MAX_POLL_JITTER_MS - 2);
    expect(highest).toBeLessThanOrEqual(DAY + MAX_POLL_JITTER_MS);
  });

  test('never swings more than the cap, at any interval', () => {
    const intervals = [
      1_000,
      30_000,
      MINUTE,
      10 * MINUTE,
      6 * 60 * MINUTE,
      DAY,
    ];
    for (const interval of intervals) {
      for (let draw = 0; draw <= 100; draw += 1) {
        const delay = nextPollDelay(interval, () => draw / 100);
        expect(delay).toBeLessThanOrEqual(interval + MAX_POLL_JITTER_MS);
        expect(delay).toBeGreaterThanOrEqual(interval - MAX_POLL_JITTER_MS);
        expect(delay).toBeGreaterThan(0);
      }
    }
  });

  test('a short interval still jitters proportionally, not by five minutes', () => {
    // 1000ms is the config floor: ±200ms, so a tick never moves by minutes.
    expect(nextPollDelay(1_000, () => 0)).toBe(800);
    expect(nextPollDelay(1_000, () => 0.999_999)).toBe(1_200);
  });
});
