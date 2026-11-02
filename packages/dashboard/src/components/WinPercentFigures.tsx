import { partyColor } from '../lib/constants.js';

/**
 * The drawings the Win % explainer is made of.
 *
 * Every figure is a share of one line — a track, a fill, a hairline rule — apart
 * from two curves, which exist because a range is not a thing a bar can show.
 * That shared vocabulary is what lets nine figures sit on one page without
 * becoming a report, and it is the same vocabulary as the count band and the
 * split bars elsewhere in the app.
 *
 * Colours are the design tokens, not literals: `hsl(var(--foreground))` and
 * friends flip with the theme, and the party bars take their real brand colours
 * so the example cannot be mistaken for a generic chart.
 */

const INK = 'hsl(var(--foreground))';
const MUTED = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const PRIMARY = 'hsl(var(--primary))';

/** The count: how much of the seat is in, and how much is still out. */
export function CountedBar({
  counted,
  height = 12,
}: {
  /** Share of the expected final vote already counted, 0–100. */
  counted: number;
  height?: number;
}) {
  return (
    <div
      className="flex overflow-hidden border"
      style={{ height }}
      aria-hidden="true"
    >
      <span
        className="block h-full bg-foreground"
        style={{ width: `${counted}%` }}
      />
      <span
        className="block h-full hatch-outstanding"
        style={{ width: `${100 - counted}%` }}
      />
    </div>
  );
}

/** Last time's result and tonight's, on the same track. */
export function PartyBars({
  prior,
  tonight,
  height = 10,
}: {
  prior: { party: string; share: number }[];
  tonight: { party: string; share: number }[];
  height?: number;
}) {
  const row = (label: string, parts: { party: string; share: number }[]) => (
    <div className="flex items-center gap-2">
      <span className="w-[44px] flex-none font-label text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div
        className="flex w-full min-w-0 flex-1 border"
        style={{ height }}
        aria-hidden="true"
      >
        {parts.map((part) => (
          <span
            key={part.party}
            className="block h-full"
            style={{
              width: `${part.share}%`,
              background: partyColor(part.party, MUTED),
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {row('2023', prior)}
      {row('tonight', tonight)}
    </div>
  );
}

export function PartyLegend({
  parties,
}: {
  parties: { party: string; label: string }[];
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-label text-[10.5px] text-muted-foreground">
      {parties.map(({ party, label }) => (
        <span key={party} className="inline-flex items-center gap-1.5">
          <i
            className="inline-block h-2 w-2"
            style={{ background: partyColor(party, MUTED) }}
            aria-hidden="true"
          />
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * The lead as a line: last time's margin on the right, the expected result
 * nearer a tie, and the swing that moved one to the other.
 *
 * The axis is deliberately not symmetric — the interesting part of the picture
 * is the 12 points between the two marks, so the span is −8 to +16 and the two
 * marks sit where the reader can see the distance between them.
 */
export function LeadLine({
  priorLead,
  expectedLead,
  width = 340,
  height = 104,
}: {
  priorLead: number;
  expectedLead: number;
  width?: number;
  height?: number;
}) {
  const from = -8;
  const to = 16;
  const sx = (x: number) => ((x - from) / (to - from)) * width;
  const base = height - 30;
  const at = (x: number) => sx(x).toFixed(1);
  const swing = priorLead - expectedLead;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      role="img"
      aria-label={`Last time National led by ${priorLead} points; the expected result is a National lead of about ${expectedLead}`}
    >
      <line
        x1="0"
        y1={base}
        x2={width}
        y2={base}
        stroke={BORDER}
        strokeWidth="1"
      />
      {[4, 8, 12, 16].map((x) => (
        <line
          key={x}
          x1={at(x)}
          y1={base - 4}
          x2={at(x)}
          y2={base + 4}
          stroke={BORDER}
          strokeWidth="1"
        />
      ))}
      {/* the tie */}
      <line
        x1={at(0)}
        y1="16"
        x2={at(0)}
        y2={base}
        stroke={PRIMARY}
        strokeWidth="1.5"
      />
      <line
        x1={at(priorLead)}
        y1="16"
        x2={at(priorLead)}
        y2={base}
        stroke={MUTED}
        strokeWidth="1.5"
      />
      <line
        x1={at(expectedLead)}
        y1="16"
        x2={at(expectedLead)}
        y2={base}
        stroke={INK}
        strokeWidth="3"
      />
      {/* the swing, from last time to the expected result */}
      <line
        x1={Number(at(priorLead)) - 4}
        y1="34"
        x2={Number(at(expectedLead)) + 6}
        y2="34"
        stroke={INK}
        strokeWidth="1"
      />
      <path d={`M${Number(at(expectedLead)) + 6} 34 l-6 -3 v6 z`} fill={INK} />
      <text
        x={at(priorLead)}
        y="10"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="9.5"
        fill={MUTED}
      >
        last time · National by {priorLead}
      </text>
      <text
        x={Number(at(expectedLead)) + 8}
        y="29"
        textAnchor="start"
        fontFamily="Inter, sans-serif"
        fontSize="9.5"
        fontWeight="600"
        fill={INK}
      >
        expected · by {expectedLead}
      </text>
      <text
        x={(Number(at(priorLead)) + Number(at(expectedLead))) / 2}
        y="47"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={MUTED}
      >
        swing −{swing}
      </text>
      <text
        x={at(0)}
        y={base + 16}
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={PRIMARY}
      >
        tie
      </text>
      <text
        x="0"
        y={base + 16}
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={MUTED}
      >
        Labour ahead
      </text>
      <text
        x={width}
        y={base + 16}
        textAnchor="end"
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={MUTED}
      >
        National ahead
      </text>
    </svg>
  );
}

/** One curve of plausible finishes, shaded on the leading side of a tie. */
export function SpreadFan({
  mean = 2,
  sd = 20,
  from = -45,
  to = 45,
  width = 340,
  height = 108,
  label = 'The range of plausible results for the final lead: most sit near a small lead, and some fall either side of a tie',
}: {
  mean?: number;
  sd?: number;
  from?: number;
  to?: number;
  width?: number;
  height?: number;
  label?: string;
}) {
  const sx = (x: number) => ((x - from) / (to - from)) * width;
  const pdf = (x: number) => Math.exp(-((x - mean) ** 2) / (2 * sd * sd));
  const peak = pdf(mean);
  const sy = (v: number) => height - (v / peak) * (height - 12);
  const points: [number, number][] = [];
  const step = (to - from) / 240;
  for (let x = from; x <= to; x += step) points.push([sx(x), sy(pdf(x))]);
  const curve = points
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const left = points.filter(([x]) => x <= sx(0));
  const shade =
    `M${sx(from)} ${height} ` +
    left.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') +
    ` L${sx(0)} ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      role="img"
      aria-label={label}
    >
      <path d={shade} fill="hsl(var(--foreground) / 0.12)" />
      <path d={curve} fill="none" stroke={INK} strokeWidth="1.5" />
      <line
        x1="0"
        y1={height}
        x2={width}
        y2={height}
        stroke={BORDER}
        strokeWidth="1"
      />
      <line
        x1={sx(0).toFixed(1)}
        y1="4"
        x2={sx(0).toFixed(1)}
        y2={height}
        stroke={PRIMARY}
        strokeWidth="1.5"
      />
      <circle
        cx={sx(mean).toFixed(1)}
        cy={sy(peak).toFixed(1)}
        r="2.5"
        fill={INK}
      />
    </svg>
  );
}

/**
 * The special vote's shift: centred on no change, with the tail that would
 * overturn the lead in red.
 *
 * The shaded area is a probability, not a scale: 34 of the 100 cases sit in the
 * red tail, which is the complement of the 66 the panel prints. A two-bar
 * comparison ("4 of 10 points") was drawn first and read as "less than half,
 * therefore unlikely" — the opposite of what the model says.
 */
export function SpecialsFan({
  threshold = 4,
  sd = 10,
  from = -22,
  to = 22,
  width = 340,
  height = 118,
}: {
  threshold?: number;
  sd?: number;
  from?: number;
  to?: number;
  width?: number;
  height?: number;
}) {
  const sx = (x: number) => ((x - from) / (to - from)) * width;
  const base = height - 24;
  const pdf = (x: number) => Math.exp(-(x ** 2) / (2 * sd * sd));
  const peak = pdf(0);
  const sy = (v: number) => base - (v / peak) * (base - 16);
  const points: [number, number, number][] = [];
  const step = (to - from) / 240;
  for (let x = from; x <= to; x += step) points.push([x, sx(x), sy(pdf(x))]);
  const curve = points
    .map(([, x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const tail = points.filter(([x]) => x >= threshold);
  const tailPath =
    `M${sx(threshold).toFixed(1)} ${base} ` +
    tail.map(([, x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') +
    ` L${sx(to).toFixed(1)} ${base} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      role="img"
      aria-label={`How far the special vote would have to shift against the leader: the chance it reaches ${threshold} points is the red tail, about 34 in 100`}
    >
      <path d={tailPath} fill="hsl(var(--primary) / 0.75)" />
      <path d={curve} fill="none" stroke={INK} strokeWidth="1.5" />
      <line
        x1="0"
        y1={base}
        x2={width}
        y2={base}
        stroke={BORDER}
        strokeWidth="1"
      />
      <line
        x1={sx(0).toFixed(1)}
        y1="16"
        x2={sx(0).toFixed(1)}
        y2={base}
        stroke={MUTED}
        strokeWidth="1"
      />
      <line
        x1={sx(threshold).toFixed(1)}
        y1="16"
        x2={sx(threshold).toFixed(1)}
        y2={base}
        stroke={PRIMARY}
        strokeWidth="1.5"
      />
      <text
        x={sx(threshold).toFixed(1)}
        y="11"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fontWeight="600"
        fill={PRIMARY}
      >
        {threshold} points to Labour
      </text>
      <text
        x={sx(0).toFixed(1)}
        y={base + 14}
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={MUTED}
      >
        no change
      </text>
      <text
        x="0"
        y={base + 14}
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={MUTED}
      >
        leans National
      </text>
      <text
        x={width}
        y={base + 14}
        textAnchor="end"
        fontFamily="Inter, sans-serif"
        fontSize="9"
        fill={MUTED}
      >
        leans Labour
      </text>
    </svg>
  );
}
