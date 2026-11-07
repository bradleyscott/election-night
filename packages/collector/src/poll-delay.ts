/**
 * How long to wait before asking the feed again.
 *
 * The loop deliberately does not tick on an exact metronome: a machine hitting
 * the feed at exactly `POLL_INTERVAL_MS` forever is a bot signature in front of
 * the feed's scoring, whatever the byte cost. So each delay is drawn within
 * ±20% of the configured interval.
 *
 * That ±20% is only worth having while it is small. At a minute it is ±12
 * seconds, which is the point. At a daily cadence it is ±4.8 hours, drawn afresh
 * every night — which disguises nothing (the feed sees one request per seat
 * either way) and turns "once a day" into a schedule that random-walks by a fifth
 * of a day each tick, so the collector drifts hours away from the time of day it
 * started at. The swing is therefore capped: the jitter keeps an interval honest
 * at any cadence instead of being proportional to it.
 *
 * Note that Node's `setTimeout` takes an int32 millisecond delay, so any interval
 * beyond ~24.8 days would overflow and fire immediately; a day is comfortably
 * inside that, and raising the cadence past it needs a different trigger.
 */

/** Largest swing, either side of the configured interval. */
export const MAX_POLL_JITTER_MS = 5 * 60_000;

/** Fraction of the interval that jitter is allowed to cover, before the cap. */
const JITTER_FRACTION = 0.2;

/**
 * One delay: `intervalMs` ± min(20% of it, 5 minutes).
 *
 * `random` is injected so the bounds can be pinned in tests.
 */
export function nextPollDelay(
  intervalMs: number,
  random: () => number = Math.random
): number {
  const swing = Math.min(intervalMs * JITTER_FRACTION, MAX_POLL_JITTER_MS);
  return Math.round(intervalMs + (random() * 2 - 1) * swing);
}
