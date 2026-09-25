import { describe, expect, test } from 'vitest';
import {
  POLLS_CLOSE_BY_YEAR,
  POLLS_COUNTING_WINDOW_MS,
  buildRuntimeConfig,
  formatPollsCountdown,
  pollsCloseInstant,
  pollsClosePhase,
  pollsCountdown,
} from './polls-close.js';

describe('POLLS_CLOSE_BY_YEAR', () => {
  test('every cycle closes at 7:00pm on a Saturday', () => {
    for (const [year, iso] of Object.entries(POLLS_CLOSE_BY_YEAR)) {
      const instant = new Date(iso);
      expect(Number.isNaN(instant.getTime()), `${year} parses`).toBe(false);

      const match = iso.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}([+-])(\d{2}):(\d{2})$/
      );
      expect(match, `${year} carries an explicit UTC offset`).not.toBeNull();
      const [, y, mo, d, h, min, sign, offH, offM] = match!;
      const offsetMs =
        (sign === '-' ? -1 : 1) * (Number(offH) * 60 + Number(offM)) * 60_000;

      // The declared local wall clock read as UTC, minus the declared offset,
      // is the instant — so 7:00pm local really is 7:00pm local.
      expect(instant.getTime(), `${year} closes at 7:00pm local`).toBe(
        Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min)) -
          offsetMs
      );
      // Polling day is always a Saturday.
      expect(
        new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay(),
        `${year} polls on a Saturday`
      ).toBe(6);
    }
  });
});

describe('pollsCloseInstant', () => {
  test('resolves a known cycle from either a string or a number', () => {
    expect(pollsCloseInstant('2026')?.toISOString()).toBe(
      '2026-11-07T06:00:00.000Z'
    );
    expect(pollsCloseInstant(2026)?.toISOString()).toBe(
      '2026-11-07T06:00:00.000Z'
    );
    // 2017 predates the daylight-saving switch-over, so it is NZST (+12).
    expect(pollsCloseInstant('2017')?.toISOString()).toBe(
      '2017-09-23T07:00:00.000Z'
    );
  });

  test('reports an unserviceable cycle as unknown rather than guessing', () => {
    expect(pollsCloseInstant('2014')).toBeNull();
    expect(pollsCloseInstant('')).toBeNull();
    expect(pollsCloseInstant(null)).toBeNull();
    expect(pollsCloseInstant(undefined)).toBeNull();
  });
});

describe('pollsClosePhase', () => {
  const closesAt = pollsCloseInstant('2026')!;
  const at = (offsetMs: number) => new Date(closesAt.getTime() + offsetMs);

  test('counts down before the close', () => {
    expect(pollsClosePhase(at(-1), closesAt)).toBe('upcoming');
    expect(pollsClosePhase(at(-60 * 60 * 1000), closesAt)).toBe('upcoming');
  });

  test('counts through election night, then stops being tonight', () => {
    expect(pollsClosePhase(at(0), closesAt)).toBe('counting');
    expect(pollsClosePhase(at(POLLS_COUNTING_WINDOW_MS - 1), closesAt)).toBe(
      'counting'
    );
    // A 2026 replay run a week later must not claim counting is happening.
    expect(pollsClosePhase(at(POLLS_COUNTING_WINDOW_MS + 1), closesAt)).toBe(
      'stale'
    );
    expect(pollsClosePhase(at(30 * 24 * 3600 * 1000), closesAt)).toBe('stale');
  });

  test('an unknown cycle has no phase', () => {
    expect(pollsClosePhase(new Date(), null)).toBe('unknown');
  });
});

describe('pollsCountdown', () => {
  const closesAt = new Date('2026-11-07T06:00:00.000Z');
  const countdown = (offsetMs: number) =>
    pollsCountdown(new Date(closesAt.getTime() - offsetMs), closesAt);

  test('breaks the remaining time into days, hours, minutes and seconds', () => {
    const fiveDays = countdown(
      5 * 86400_000 + 3 * 3600_000 + 41 * 60_000 + 30_000
    );
    expect(fiveDays).toMatchObject({
      days: 5,
      hours: 3,
      minutes: 41,
      seconds: 30,
      showSeconds: false,
    });
    expect(formatPollsCountdown(fiveDays)).toBe('5d 03h 41m');
  });

  test('shows only hours and minutes outside the final hour', () => {
    const fourHours = countdown(4 * 3600_000 + 12 * 60_000);
    expect(formatPollsCountdown(fourHours)).toBe('4h 12m');
  });

  test('shows seconds inside the final hour', () => {
    const finalMinutes = countdown(41 * 60_000 + 7_000);
    expect(finalMinutes.showSeconds).toBe(true);
    expect(formatPollsCountdown(finalMinutes)).toBe('00:41:07');
  });

  test('clamps once polls have closed', () => {
    const closed = countdown(-5 * 60_000);
    expect(closed.remainingMs).toBe(0);
    expect(formatPollsCountdown(closed)).toBe('00:00:00');
  });
});

describe('buildRuntimeConfig', () => {
  test('carries the cycle, the close instant and a server clock', () => {
    const now = new Date('2026-11-07T02:00:00.000Z');

    expect(buildRuntimeConfig('2026', now)).toEqual({
      electionYear: '2026',
      pollsCloseAt: '2026-11-07T06:00:00.000Z',
      serverTime: '2026-11-07T02:00:00.000Z',
    });
  });

  test('an unset or unserviceable year reports no close instant', () => {
    expect(buildRuntimeConfig(undefined).pollsCloseAt).toBeNull();
    expect(buildRuntimeConfig(undefined).electionYear).toBeNull();
    expect(buildRuntimeConfig('2014').pollsCloseAt).toBeNull();
    expect(buildRuntimeConfig('2014').electionYear).toBe('2014');
  });
});
