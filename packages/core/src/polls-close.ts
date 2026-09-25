/**
 * Election-night timing: when polls close in each cycle, and the countdown
 * the dashboard's masthead renders from it.
 *
 * Voting places open at 9am and close at 7pm local time on election day, so
 * "polls close" is 7:00pm on polling day. The UTC offset is *not* fixed:
 * election day sometimes falls before the daylight-saving switch-over (2am on
 * the last Sunday in September), so 2017 ran on NZST (+12) while 2020, 2023
 * and 2026 ran on NZDT (+13). Instants are written with an explicit offset
 * rather than a timezone name so the value never depends on the runtime's
 * timezone database.
 *
 * Only cycles this app can actually serve are listed. An unknown year yields
 * `null` — the dashboard falls back to a plain clock rather than counting
 * down to another election's date. To add the next cycle: 7:00pm on polling
 * day, with the offset in force that day.
 *
 * Sources:
 * - Polling hours (9am–7pm on election day):
 *   https://elections.nz/guidance-and-rules/candidate-hub/resources/enrolment-and-resources-2
 * - Election dates: https://electionresults.govt.nz/
 * - Daylight saving dates:
 *   https://www.govt.nz/browse/recreation-and-the-environment/daylight-saving/
 */

export const POLLS_CLOSE_BY_YEAR: Readonly<Record<string, string>> = {
  // Saturday 23 September 2017, still NZST (daylight saving began 24 September).
  '2017': '2017-09-23T19:00:00+12:00',
  // Saturday 17 October 2020, NZDT.
  '2020': '2020-10-17T19:00:00+13:00',
  // Saturday 14 October 2023, NZDT.
  '2023': '2023-10-14T19:00:00+13:00',
  // Saturday 7 November 2026, NZDT.
  '2026': '2026-11-07T19:00:00+13:00',
};

/**
 * How long after polls close the night is still "tonight". Past this, a close
 * instant can only be an archived cycle being replayed, which has no live
 * count behind it.
 */
export const POLLS_COUNTING_WINDOW_MS = 12 * 60 * 60 * 1000;

export type PollsClosePhase =
  /** Counting down: polls have not closed yet. */
  | 'upcoming'
  /** Election night, after the close: votes are being counted. */
  | 'counting'
  /** The close instant is long past — an archived cycle, not tonight. */
  | 'stale'
  /** No close instant is known for this cycle. */
  | 'unknown';

export type PollsCountdown = {
  /** Milliseconds until polls close, clamped at 0. */
  remainingMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Inside the final hour, where the seconds are worth showing. */
  showSeconds: boolean;
};

/** The instant polls close for `year`, or null when the cycle is unknown. */
export function pollsCloseInstant(
  year: string | number | null | undefined
): Date | null {
  if (year === null || year === undefined) return null;
  const iso = POLLS_CLOSE_BY_YEAR[String(year).trim()];
  if (!iso) return null;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function pollsClosePhase(
  now: Date,
  closesAt: Date | null
): PollsClosePhase {
  if (!closesAt) return 'unknown';
  const elapsedMs = now.getTime() - closesAt.getTime();
  if (elapsedMs < 0) return 'upcoming';
  return elapsedMs <= POLLS_COUNTING_WINDOW_MS ? 'counting' : 'stale';
}

export function pollsCountdown(now: Date, closesAt: Date): PollsCountdown {
  const remainingMs = Math.max(0, closesAt.getTime() - now.getTime());
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    remainingMs,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    showSeconds: remainingMs < 3_600_000,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * `4h 12m` / `5d 03h 41m` / `00:41:07` (the final hour). Uppercased by the
 * caller — copy and case belong to the view, not here.
 */
export function formatPollsCountdown(countdown: PollsCountdown): string {
  if (countdown.showSeconds) {
    return `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
  }
  if (countdown.days > 0) {
    return `${countdown.days}d ${pad(countdown.hours)}h ${pad(countdown.minutes)}m`;
  }
  return `${countdown.hours}h ${pad(countdown.minutes)}m`;
}

/**
 * Runtime facts the frontend cannot know at build time, served on
 * `GET /api/config`. `serverTime` lets the client correct for a device clock
 * that is wrong — a countdown read off a laptop an hour out would be worse
 * than no countdown.
 */
export type RuntimeConfig = {
  /** Election cycle the server is serving, or null when `ELECTION_YEAR` is unset. */
  electionYear: string | null;
  /** When polls close for that cycle (ISO 8601, UTC), or null when unknown. */
  pollsCloseAt: string | null;
  /** The server's clock at response time (ISO 8601, UTC). */
  serverTime: string;
};

export function buildRuntimeConfig(
  electionYear: string | null | undefined,
  now: Date = new Date()
): RuntimeConfig {
  const closesAt = pollsCloseInstant(electionYear);
  const year =
    electionYear === null || electionYear === undefined
      ? null
      : String(electionYear).trim() || null;
  return {
    electionYear: year,
    pollsCloseAt: closesAt ? closesAt.toISOString() : null,
    serverTime: now.toISOString(),
  };
}
