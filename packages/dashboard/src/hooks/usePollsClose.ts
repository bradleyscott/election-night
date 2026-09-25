import { useEffect, useMemo, useState } from 'react';
import {
  pollsClosePhase,
  pollsCountdown,
  type PollsClosePhase,
  type PollsCountdown,
  type RuntimeConfig,
} from '@election-night/core/polls-close';
import { useApi } from './useApi.js';

/** Outside the final hour the display only shows minutes, so a 30s tick is plenty. */
const MINUTE_TICK_MS = 30_000;
const SECOND_TICK_MS = 1_000;

export type PollsCloseState = {
  phase: PollsClosePhase;
  /** Set while the countdown is running; null once polls close. */
  countdown: PollsCountdown | null;
  /** When polls close for this cycle, or null when the server did not say. */
  closesAt: Date | null;
};

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Counts down to polls close for the cycle the server is serving.
 *
 * The close instant comes from the server (`GET /api/config`), so a new cycle
 * needs no frontend rebuild — only `ELECTION_YEAR`. The "now" side is the
 * visitor's own clock, not the server's: visitors' devices are NTP-synced, and
 * a server whose clock is wrong would otherwise put every visitor hours out on
 * the one night the countdown matters (a Fly machine in this project's own
 * deployment ran ten hours slow until it was restarted). A wrong device clock
 * then only affects the person holding that device, which is also true of every
 * other time in the app — feed timestamps are compared against the local clock
 * too. When the year has no known close instant the state is `unknown` and
 * callers fall back to the plain clock.
 */
export function usePollsClose(): PollsCloseState {
  const { data } = useApi<RuntimeConfig>('/api/config');

  const closesAt = useMemo(
    () => parseInstant(data?.pollsCloseAt),
    [data?.pollsCloseAt]
  );

  const [nowMs, setNowMs] = useState(() => Date.now());

  const now = new Date(nowMs);
  const remainingMs = closesAt ? closesAt.getTime() - now.getTime() : null;
  const tickMs =
    remainingMs !== null && remainingMs > 0
      ? remainingMs <= 3_600_000
        ? SECOND_TICK_MS
        : MINUTE_TICK_MS
      : null;

  useEffect(() => {
    // Nothing to tick once polls have closed (the label is static then) and
    // nothing to tick towards when the cycle has no close instant.
    if (tickMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  const phase = pollsClosePhase(now, closesAt);

  return {
    phase,
    closesAt,
    countdown:
      phase === 'upcoming' && closesAt ? pollsCountdown(now, closesAt) : null,
  };
}
