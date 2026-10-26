import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import {
  AXIS_STROKE,
  COUNTED_COLOR,
  GRID_DASH,
  GRID_STROKE,
  formatClock,
  formatTooltipStamp,
  timeTicks,
} from '../lib/chart-format.js';

export type TapePoint = {
  /** Instant of the scrape this point came from, in epoch milliseconds. */
  t: number;
  /** The series value at that scrape, in the axis' own unit. */
  value: number;
  /** Optional second line for the readout, e.g. the vote count behind it. */
  sub?: string;
};

type CountedTapeProps = {
  points: TapePoint[];
  /**
   * Receipt times (epoch ms) of the voting places already counted. Drawn as a
   * rug under the axis: the count only ever moves when a place lands, so the
   * ticks are the same series at a finer resolution. Omit for a series with no
   * per-place detail (the country reports totals, not places).
   */
  receipts?: number[];
  /** Axis ticks, bottom to top. The top tick is the axis maximum. */
  yTicks: number[];
  formatTick: (value: number) => string;
  formatValue: (value: number) => string;
  height?: number;
  /** Legend wording; the seat says "Votes counted", the country "Counted". */
  label?: string;
  receiptsLabel?: string;
  /** Right-hand note in the legend row, e.g. "9 / 22 places". */
  note?: ReactNode;
  emptyLabel?: string;
  className?: string;
};

const PAD = { left: 46, right: 14, top: 14, bottom: 26 };
const RUG_HEIGHT = 10;
const FALLBACK_WIDTH = 720;

/**
 * Steps from one scrape to the next and stops at the last one.
 *
 * No smoothing and no projection: a count is a record of what has landed, so
 * the line only moves when a number moves, and the right edge is the latest
 * scrape rather than a forecast of midnight.
 */
function stepPath(projected: Array<{ x: number; y: number }>) {
  if (projected.length === 0) return '';
  let d = `M ${projected[0]!.x.toFixed(2)} ${projected[0]!.y.toFixed(2)}`;
  for (let i = 1; i < projected.length; i++) {
    const point = projected[i]!;
    d += ` H ${point.x.toFixed(2)} V ${point.y.toFixed(2)}`;
  }
  return d;
}

export function CountedTape({
  points,
  receipts,
  yTicks,
  formatTick,
  formatValue,
  height = 280,
  label = 'Counted',
  receiptsLabel = 'Place reported',
  note,
  emptyLabel = 'No count yet',
  className,
}: CountedTapeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const top = yTicks[yTicks.length - 1] ?? 1;
  const hasRug = Boolean(receipts && receipts.length > 0);
  const plotTop = PAD.top;
  const plotBottom = height - PAD.bottom - (hasRug ? RUG_HEIGHT : 0);
  const plotLeft = PAD.left;
  const plotRight = Math.max(plotLeft + 1, width - PAD.right);
  const plotWidth = plotRight - plotLeft;
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const domain = useMemo(() => {
    // The axis is the series' own span: a receipt that landed after the last
    // scrape is not in the count yet, so drawing it at the edge would claim the
    // number already includes it.
    if (points.length === 0) return null;
    const from = points[0]!.t;
    const to = points[points.length - 1]!.t;
    return { from, to: to > from ? to : from + 60_000 };
  }, [points]);

  const x = useCallback(
    (t: number) =>
      domain
        ? plotLeft + ((t - domain.from) / (domain.to - domain.from)) * plotWidth
        : plotLeft,
    [domain, plotLeft, plotWidth]
  );
  const y = useCallback(
    (v: number) => plotBottom - (v / (top || 1)) * plotHeight,
    [plotBottom, plotHeight, top]
  );

  const path = useMemo(
    () => stepPath(points.map((p) => ({ x: x(p.t), y: y(p.value) }))),
    [points, x, y]
  );

  const ticks = useMemo(
    () =>
      domain ? timeTicks(domain.from, domain.to, width > 520 ? 8 : 6) : [],
    [domain]
  );

  const handlePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!domain || points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const t =
      domain.from + ((px - plotLeft) / plotWidth) * (domain.to - domain.from);
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i]!.t - t) < Math.abs(points[best]!.t - t)) best = i;
    }
    setHover({ x: x(points[best]!.t), index: best });
  };

  if (points.length === 0 || !domain) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border border-dashed border-border text-sm text-muted-foreground',
          className
        )}
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const hovered = hover ? points[hover.index] : null;
  const tipLeft = hover
    ? Math.min(Math.max(hover.x - 52, 2), Math.max(2, width - 116))
    : 0;

  return (
    <div className={className}>
      <div ref={wrapRef} className="relative">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${label}: ${formatValue(
            points[points.length - 1]!.value
          )} as at ${formatClock(points[points.length - 1]!.t)}${note ? `, ${String(note)}` : ''}`}
          className="block touch-pan-y"
          onPointerMove={handlePointer}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={y(tick)}
                y2={y(tick)}
                stroke={GRID_STROKE}
                strokeWidth={1}
                strokeDasharray={GRID_DASH}
              />
              <text
                x={plotLeft - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
                className="font-mono"
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {ticks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={plotTop}
                y2={plotBottom}
                stroke={GRID_STROKE}
                strokeWidth={1}
                strokeDasharray={GRID_DASH}
              />
              <text
                x={x(tick)}
                y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
                className="font-mono"
              >
                {formatClock(tick)}
              </text>
            </g>
          ))}

          <line
            x1={plotLeft}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
            stroke={AXIS_STROKE}
            strokeWidth={1}
          />
          <line
            x1={plotLeft}
            x2={plotLeft}
            y1={plotTop}
            y2={plotBottom}
            stroke={AXIS_STROKE}
            strokeWidth={1}
          />

          <path
            d={path}
            fill="none"
            stroke={COUNTED_COLOR}
            strokeWidth={1.8}
            strokeLinejoin="miter"
            strokeLinecap="butt"
          />

          {hasRug &&
            receipts!
              .filter((t) => t >= domain.from && t <= domain.to)
              .map((t) => (
                <line
                  key={`rug-${t}`}
                  x1={x(t)}
                  x2={x(t)}
                  y1={plotBottom + 2}
                  y2={plotBottom + 2 + RUG_HEIGHT - 2}
                  stroke={COUNTED_COLOR}
                  strokeWidth={1.2}
                  opacity={0.8}
                />
              ))}

          {hover && hovered && (
            <g>
              <line
                x1={hover.x}
                x2={hover.x}
                y1={plotTop}
                y2={hasRug ? plotBottom + RUG_HEIGHT : plotBottom}
                stroke="hsl(var(--foreground))"
                strokeWidth={1}
                opacity={0.28}
              />
              <circle
                cx={hover.x}
                cy={y(hovered.value)}
                r={3}
                fill={COUNTED_COLOR}
                stroke="hsl(var(--card))"
                strokeWidth={1.5}
              />
            </g>
          )}
        </svg>

        {hover && hovered && (
          <div
            className="pointer-events-none absolute border bg-popover p-3 text-sm max-w-xs shadow-none"
            style={{
              left: tipLeft,
              top: Math.max(0, y(hovered.value) - 66),
            }}
          >
            <p className="font-label font-bold text-muted-foreground text-xs mb-1.5 uppercase tracking-wide">
              {formatTooltipStamp(hovered.t)}
            </p>
            <div className="flex items-center justify-between gap-3 py-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className="w-2 h-2 shrink-0 ring-1 ring-foreground/20"
                  style={{ backgroundColor: COUNTED_COLOR }}
                />
                <span className="font-semibold truncate">{label}</span>
              </div>
              <span className="tabular-nums font-bold text-right shrink-0">
                {formatValue(hovered.value)}
              </span>
            </div>
            {hovered.sub ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {hovered.sub}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-label text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-[1.5px] w-[18px]"
            style={{ backgroundColor: COUNTED_COLOR }}
          />
          {label}
        </span>
        {hasRug && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-[9px] w-[2px]"
              style={{ backgroundColor: COUNTED_COLOR }}
            />
            {receiptsLabel}
          </span>
        )}
        {note && (
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

export default CountedTape;
