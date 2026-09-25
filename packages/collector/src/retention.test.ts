import { describe, expect, test } from 'vitest';
import {
  PRESSURE_KEEP_HOURS,
  describeSweep,
  effectiveKeepHours,
  isUnderDiskPressure,
  shouldSweep,
} from './retention.js';

const GIB = 1024 ** 3;
const volume = (availableFraction: number) => ({
  path: '/data',
  size: 1 * GIB,
  available: Math.round(availableFraction * GIB),
});

describe('isUnderDiskPressure', () => {
  test('is false at the threshold and true below it', () => {
    // Exact integers, so the boundary is not a floating-point accident.
    const exact = (size: number, available: number) => ({
      path: '/data',
      size,
      available,
    });
    expect(isUnderDiskPressure(exact(1000, 50))).toBe(false);
    expect(isUnderDiskPressure(exact(1000, 49))).toBe(true);
    expect(isUnderDiskPressure(volume(0.5))).toBe(false);
  });

  test('an unknown sample is not pressure', () => {
    // A database whose filesystem cannot be sampled must not be treated as
    // full — that would delete history on the strength of a failed statfs.
    expect(isUnderDiskPressure(null)).toBe(false);
    expect(isUnderDiskPressure({ path: '/data', size: 0, available: 0 })).toBe(
      false
    );
  });
});

describe('effectiveKeepHours', () => {
  test('keeps the configured window while there is room', () => {
    expect(effectiveKeepHours(24, volume(0.5))).toBe(24);
  });

  test('collapses the window under pressure, down to the floor', () => {
    expect(effectiveKeepHours(24, volume(0.01))).toBe(PRESSURE_KEEP_HOURS);
    // Never extends the window, and never exceeds what was configured.
    expect(effectiveKeepHours(0.5, volume(0.01))).toBe(0.5);
  });

  test('retention disabled stays disabled, pressure or not', () => {
    expect(effectiveKeepHours(0, volume(0.01))).toBe(0);
    expect(effectiveKeepHours(0, volume(0.9))).toBe(0);
  });
});

describe('shouldSweep', () => {
  test('sweeps at the interval, not before it', () => {
    const now = 10_000_000;
    expect(shouldSweep(null, now, 900_000)).toBe(true);
    expect(shouldSweep(now, now, 900_000)).toBe(false);
    expect(shouldSweep(now - 899_999, now, 900_000)).toBe(false);
    expect(shouldSweep(now - 900_000, now, 900_000)).toBe(true);
  });

  test('an interval of 0 disables periodic sweeps', () => {
    expect(shouldSweep(null, 10_000_000, 0)).toBe(false);
    expect(shouldSweep(1, 10_000_000, 0)).toBe(false);
  });
});

describe('describeSweep', () => {
  test('names what was pruned and what was reclaimed', () => {
    expect(
      describeSweep({
        deletedSnapshots: 42,
        freedPages: 7,
        keepHours: 24,
        underPressure: false,
      })
    ).toBe('Retention: pruned 42 snapshot(s) older than 24h, reclaimed 7 page(s)');
  });

  test('says so when the volume forced a shorter window', () => {
    expect(
      describeSweep({
        deletedSnapshots: 900,
        freedPages: 0,
        keepHours: 1,
        underPressure: true,
      })
    ).toContain('volume below threshold');
  });
});
