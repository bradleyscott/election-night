import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ElectorateHistoryPoint } from '../lib/history-types.js';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';

type ChartMode = 'votes' | 'percentage' | 'candidateVotes' | 'counted';

type ChartProps = {
  history: ElectorateHistoryPoint[];
  mode?: ChartMode;
  showParty?: boolean;
  className?: string;
};

function parseDate(startedAt: string): Date {
  return new Date(startedAt + (startedAt.endsWith('Z') ? '' : 'Z'));
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatFullDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-NZ', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getEntityColor(party: string | null): string {
  if (party && partyColors[party]) return partyColors[party];
  return '#666';
}

function isDarkColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.35;
}

function VoteChartTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean;
  payload?: {
    name: string;
    value: number;
    color: string;
    dataKey: string;
    payload?: Record<string, unknown>;
  }[];
  label?: string;
  mode: ChartMode;
}) {
  if (!active || !payload || !label) return null;

  const labelStr = formatFullDate(Number(label));

  return (
    <div className="border bg-popover p-3 text-sm max-w-xs">
      <p className="font-label font-bold text-muted-foreground text-xs mb-1.5 uppercase tracking-wide">
        {labelStr}
      </p>
      {payload.map((entry) => {
        return (
          <div
            key={entry.dataKey}
            className="flex items-center justify-between gap-3 py-0.5"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className="w-2 h-2 shrink-0 ring-1 ring-foreground/20"
                style={{ backgroundColor: entry.color }}
              />
              <span className="font-semibold truncate">{entry.name}</span>
            </div>
            <span className="tabular-nums font-bold text-right shrink-0">
              {mode === 'percentage' || mode === 'counted'
                ? `${(entry.value * 100).toFixed(1)}%`
                : entry.value.toLocaleString()}
              {mode === 'counted' &&
                entry.payload &&
                (entry.payload.votesCounted as number) > 0 && (
                  <span className="ml-1 text-muted-foreground font-semibold">
                    ({(entry.payload.votesCounted as number).toLocaleString()})
                  </span>
                )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VoteChartLegend({
  entities,
  maxVisible = 5,
}: {
  entities: Array<{ name: string; party: string | null; color?: string }>;
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (entities.length === 0) return null;

  const visible = expanded ? entities : entities.slice(0, maxVisible);
  const hiddenCount = entities.length - visible.length;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center">
        {visible.map((entry) => {
          const color = entry.color ?? getEntityColor(entry.party);
          return (
            <div key={entry.name} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 shrink-0 ring-1 ring-foreground/20"
                style={{ backgroundColor: color }}
              />
              <span
                className="font-label text-xs font-semibold text-foreground"
                title={entry.name}
              >
                {entry.name}
              </span>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 mx-auto block font-label text-xs font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1 border border-border bg-background transition-colors"
        >
          {expanded ? 'Show less ▲' : `+ ${hiddenCount} more ▼`}
        </button>
      )}
    </div>
  );
}

export default function VoteHistoryChart({
  history,
  mode = 'votes',
  showParty = false,
  className,
}: ChartProps) {
  const [chartMode, setChartMode] = useState<ChartMode>(mode);

  const chartData = useMemo(() => {
    return history.map((point) => {
      const total = point.votesCounted || 1;
      const ts = parseDate(point.startedAt).getTime();
      const row: Record<string, number | string> = {
        ts,
        time: formatTime(ts),
        fullDate: formatFullDate(ts),
        votesCounted: point.votesCounted,
        pctCounted: point.votePctCounted,
      };

      if (showParty) {
        for (const p of point.partyVotes) {
          if (p.votes === 0) continue;
          row[`party:${p.party}`] =
            chartMode === 'percentage' ? p.votes / total : p.votes;
        }
      } else {
        for (const c of point.candidates) {
          if (c.votes === 0) continue;
          row[`candidate:${c.candidate}`] =
            chartMode === 'percentage' ? c.votes / total : c.votes;
        }
      }

      return row;
    });
  }, [history, chartMode, showParty]);

  // Tick interval is a multiple of 5 minutes, chosen by the overall time span
  const xTicks = useMemo(() => {
    if (history.length < 2) return [];
    const min = parseDate(history[0].startedAt).getTime();
    const max = parseDate(history[history.length - 1].startedAt).getTime();
    const spanMs = max - min;
    const MIN = 60 * 1000;
    const FIVE_MIN = 5 * MIN;
    const TEN_MIN = 10 * MIN;
    const FIFTEEN_MIN = 15 * MIN;
    const THIRTY_MIN = 30 * MIN;
    const ONE_HOUR = 60 * MIN;

    let intervalMs: number;
    if (spanMs <= 30 * MIN) intervalMs = FIVE_MIN;
    else if (spanMs <= 60 * MIN) intervalMs = TEN_MIN;
    else if (spanMs <= 2 * 60 * MIN) intervalMs = FIFTEEN_MIN;
    else if (spanMs <= 4 * 60 * MIN) intervalMs = THIRTY_MIN;
    else intervalMs = ONE_HOUR;

    const start = new Date(Math.floor(min / intervalMs) * intervalMs);
    const ticks: number[] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= max + intervalMs) {
      ticks.push(cursor.getTime());
      cursor.setTime(cursor.getTime() + intervalMs);
    }
    return ticks;
  }, [history]);

  // Determine which entities to show lines for (candidates or parties with votes > 0),
  // sorted by current vote count so the most relevant series appear first in the legend.
  const entities = useMemo(() => {
    if (history.length === 0) return [];
    const latest = history[history.length - 1];
    if (showParty) {
      return latest.partyVotes
        .filter((p) => p.votes > 0)
        .sort((a, b) => b.votes - a.votes)
        .map((p) => ({
          name: p.party,
          party: p.party,
        }));
    }
    return latest.candidates
      .filter((c) => c.votes > 0)
      .sort((a, b) => b.votes - a.votes)
      .map((c) => ({
        name: c.candidate,
        party: c.party,
      }));
  }, [history, showParty]);

  const prefix = showParty ? 'party:' : 'candidate:';
  const chartTitle =
    chartMode === 'counted' ? 'Count progress' : 'Vote share trend';

  if (history.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'border p-3 sm:p-4',
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="kicker">{chartTitle}</div>
        <div className="flex flex-wrap border border-border">
          <button
            onClick={() => setChartMode('votes')}
            className={cn(
              'px-2.5 py-1 font-label text-xs sm:text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              chartMode === 'votes'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            # Votes
          </button>
          <button
            onClick={() => setChartMode('percentage')}
            className={cn(
              'px-2.5 py-1 font-label text-xs sm:text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              chartMode === 'percentage'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            % of Vote
          </button>
          <button
            onClick={() => setChartMode('counted')}
            className={cn(
              'px-2.5 py-1 font-label text-xs sm:text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              chartMode === 'counted'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            Counted
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            verticalPoints={xTicks.length > 0 ? xTicks : undefined}
          />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            tickFormatter={(v: number) => formatTime(v)}
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            domain={chartMode === 'counted' ? [0, 1] : ['auto', 'auto']}
            tickFormatter={
              chartMode === 'percentage' || chartMode === 'counted'
                ? (v: number) => `${(v * 100).toFixed(0)}%`
                : (v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toLocaleString()
            }
          />
          <Tooltip content={<VoteChartTooltip mode={chartMode} />} />
          {chartMode === 'counted' ? (
            <Line
              type="monotone"
              dataKey="pctCounted"
              name="Counted"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : (
            entities.map((e) => {
              const color = getEntityColor(e.party);
              const dark = isDarkColor(color);
              return (
                <Line
                  key={e.name}
                  type="monotone"
                  dataKey={`${prefix}${e.name}`}
                  name={e.name}
                  stroke={color}
                  strokeWidth={dark ? 3 : 2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  style={
                    dark
                      ? {
                          filter:
                            'drop-shadow(0px 0px 2px rgba(255,255,255,0.5))',
                        }
                      : undefined
                  }
                />
              );
            })
          )}
        </LineChart>
      </ResponsiveContainer>
      {chartMode === 'counted' ? (
        <VoteChartLegend
          entities={[{ name: 'Counted', party: null, color: '#22c55e' }]}
        />
      ) : (
        <VoteChartLegend entities={entities} />
      )}
    </div>
  );
}
