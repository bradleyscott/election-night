import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { ElectorateHistoryPoint } from '../lib/history-types.js';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';

type ChartMode = 'votes' | 'percentage' | 'candidateVotes';

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
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: string;
  mode: ChartMode;
}) {
  if (!active || !payload || !label) return null;

  const labelStr = formatFullDate(Number(label));

  return (
    <div className="rounded-xl border bg-card shadow-lg p-3 text-sm max-w-xs">
      <p className="font-bold text-muted-foreground text-xs mb-1.5 uppercase tracking-wide">
        {labelStr}
      </p>
      {payload.map((entry) => {
        const dark = isDarkColor(entry.color);
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 py-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={cn('w-2 h-2 rounded-full shrink-0 ring-1', dark ? 'ring-white/50' : 'ring-black/10')}
                style={{ backgroundColor: entry.color }}
              />
              <span className="font-semibold truncate">{entry.name}</span>
            </div>
            <span className="tabular-nums font-bold text-right shrink-0">
              {mode === 'percentage'
                ? `${(entry.value * 100).toFixed(1)}%`
                : entry.value.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VoteChartLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
  if (!payload || payload.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 justify-center mt-2">
      {payload.map((entry) => {
        const dark = isDarkColor(entry.color);
        return (
          <div key={entry.value} className="flex items-center gap-1.5">
            <div
              className={cn('w-2.5 h-2.5 rounded-full shrink-0 ring-1', dark ? 'ring-white/50' : 'ring-black/10')}
              style={{ backgroundColor: entry.color }}
            />
            <span
              className={cn('text-xs font-bold', dark ? 'text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]' : 'text-foreground')}
            >
              {entry.value}
            </span>
          </div>
        );
      })}
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

  // Determine which entities to show lines for (candidates or parties with votes > 0)
  const entities = useMemo(() => {
    if (history.length === 0) return [];
    const latest = history[history.length - 1];
    if (showParty) {
      return latest.partyVotes
        .filter((p) => p.votes > 0)
        .map((p) => ({
          name: p.party,
          party: p.party,
        }));
    }
    return latest.candidates
      .filter((c) => c.votes > 0)
      .map((c) => ({
        name: c.candidate,
        party: c.party,
      }));
  }, [history, showParty]);

  const prefix = showParty ? 'party:' : 'candidate:';
  const chartTitle = 'Vote share trend';

  if (history.length === 0) {
    return null;
  }

  return (
    <div className={cn('rounded-xl border bg-card p-3 sm:p-4 shadow-sm', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
          {chartTitle}
        </div>
        <div className="flex rounded-full border border-border p-0.5 bg-muted/50">
          <button
            onClick={() => setChartMode('votes')}
            className={cn(
              'rounded-full px-3 py-1 text-xs sm:text-sm font-bold tracking-wide transition-colors',
              chartMode === 'votes'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            # Votes
          </button>
          <button
            onClick={() => setChartMode('percentage')}
            className={cn(
              'rounded-full px-3 py-1 text-xs sm:text-sm font-bold tracking-wide transition-colors',
              chartMode === 'percentage'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            % of Vote
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
            tickFormatter={
              chartMode === 'percentage'
                ? (v: number) => `${(v * 100).toFixed(1)}%`
                : (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toLocaleString()
            }
          />
          <Tooltip content={<VoteChartTooltip mode={chartMode} />} />
          <Legend content={<VoteChartLegend />} />
          {entities.map((e) => {
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
                style={dark ? { filter: 'drop-shadow(0px 0px 2px rgba(255,255,255,0.5))' } : undefined}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
