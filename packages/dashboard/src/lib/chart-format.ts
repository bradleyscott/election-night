/**
 * One vocabulary for chart axes and readouts.
 *
 * The three chart modes on the electorate and Trends pages draw the same night
 * in different units — votes, a share of the vote, and how much of it has been
 * counted — so the numerals around them must not change voice when the mode
 * does: same mono face, same rounding, same "1.4M" and "47%" on either page.
 */

/** The series colour the Counted chart has always worn. */
export const COUNTED_COLOR = '#22c55e';

/** Numerals are set in the mono face, as every other figure in the app is. */
export const AXIS_FONT = '"IBM Plex Mono", ui-monospace, monospace';

/** Recharts tick styling, identical on every axis of every chart. */
export const AXIS_TICK = { fontSize: 10, fontFamily: AXIS_FONT } as const;

/** Grid/axis hairline, from the print palette. */
export const AXIS_STROKE = 'hsl(var(--muted-foreground))';
export const GRID_STROKE = 'hsl(var(--border))';
export const GRID_DASH = '3 3';

/** Axis ticks: 1.4M, 312k, 1,200. */
export function formatVoteAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toLocaleString();
}

/** Readouts keep every digit: a count is not abbreviated away in a tooltip. */
export function formatVotes(value: number): string {
  return Math.round(value).toLocaleString();
}

/** Axis ticks: 0%, 25%, 50%. Takes a percentage, not a fraction. */
export function formatPercentAxis(value: number): string {
  return `${value.toFixed(0)}%`;
}

/** Readouts: 47.7%. Takes a percentage, not a fraction. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Clock labels: 7:04pm, in the feed's own wall clock. */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Tooltip heading: Nov 7 · 6:04pm — one stamp for every chart. */
export function formatTooltipStamp(ts: number): string {
  const date = new Date(ts).toLocaleDateString('en-NZ', {
    month: 'short',
    day: 'numeric',
  });
  return `${date} · ${formatClock(ts)}`;
}

/**
 * Tick instants at a round interval that suits the span, so a two-hour rush and
 * a six-hour night both read at a glance. Shared so the drawn tape and the
 * recharts charts label their axes identically.
 */
export function timeTicks(from: number, to: number, maxLabels = 6): number[] {
  const MIN = 60 * 1000;
  const span = to - from;
  const ladder = [1, 2, 5, 10, 15, 30, 60, 120, 240].map((m) => m * MIN);
  const interval =
    ladder.find((step) => span / step <= maxLabels) ??
    ladder[ladder.length - 1]!;

  // Leave the last tenth of the span unlabelled: a label centred on the final
  // tick overflows the plot box, so the axis ends on the last one that fits.
  const ticks: number[] = [];
  const last = to - span * 0.1;
  for (
    let t = Math.ceil(from / interval) * interval;
    t <= last;
    t += interval
  ) {
    ticks.push(t);
  }
  return ticks;
}
