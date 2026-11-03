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

/** IBM Plex Mono's advance, in ems: every glyph is the same width. */
const MONO_ADVANCE = 0.6;

/**
 * How wide a y axis has to be for its own labels.
 *
 * The tick face is IBM Plex Mono, whose advance is a fixed 0.6em, so a label's
 * width is a character count rather than something that has to be measured:
 * `100%` is 24px at the 10px tick size. That is what lets the hand-drawn tape
 * reserve exactly the gutter its labels need instead of a guessed one — the
 * recharts charts measure instead (`<YAxis width="auto" />`), because recharts
 * decides its own tick values and so does not know the strings in advance.
 */
export function axisLabelWidth(labels: string[]): number {
  const widest = labels.reduce(
    (longest, label) => Math.max(longest, label.length),
    0
  );
  return Math.ceil(widest * AXIS_TICK.fontSize * MONO_ADVANCE);
}

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

/**
 * Readouts keep every digit: a count is not abbreviated away in a tooltip.
 *
 * This is the display boundary for counted things — votes, margins, a
 * candidate's total. An *estimate* goes through `formatEstimate` instead.
 */
export function formatVotes(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * An estimate, to two significant figures: "about 5,700 votes", "about
 * 15,000 votes".
 *
 * The seat model's two estimates — tonight's votes still out and the special
 * votes still to come — are built the same way: enrolment (a recorded roll)
 * times a *national* cycle constant (turnout, night share, special share) times
 * a per-seat figure. The national constants are applied to every seat, so the
 * error is relative, not absolute: `REMAINING_SIZE_SD` puts it at 12% for the
 * outstanding vote, and the special-vote estimate has the same construction and
 * the same order of error. That makes a decimal-place rule wrong in both
 * directions — the old "about 6,308 votes" claimed three more digits than the
 * number has, and a nearest-ten rule hands the *smaller* estimate the most
 * precision of all, which is backwards.
 *
 * Two figures is what the word "about" already promises, and it is one rule
 * whether the estimate is 5,723 or 15,327. Counted facts are untouched: a
 * count prints exactly, an estimate prints to two significant figures.
 */
export function formatEstimate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(Number(value.toPrecision(2))).toLocaleString();
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

/**
 * Parse a timestamp in the form the history API writes it.
 *
 * `started_at` comes from SQLite's `CURRENT_TIMESTAMP` as `2023-10-14
 * 07:04:05` with no zone. It is UTC, but a bare date-time string is parsed as
 * local time, which would shift every point on a chart by the reader's own
 * offset. Appending `Z` (when the string does not already carry a zone) is
 * what makes a tape's x-axis agree with the feed's wall clock.
 */
export function parseDbTimestamp(startedAt: string): number {
  return new Date(startedAt + (startedAt.endsWith('Z') ? '' : 'Z')).getTime();
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
