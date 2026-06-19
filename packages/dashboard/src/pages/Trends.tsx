import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { usePartyVoteHistory } from '../hooks/useVoteHistory.js';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from '../components/WaitingState.js';

type Mode = 'votes' | 'percent' | 'seats';

const ALL_PARTIES = Object.keys(partyColors);

function formatDate(startedAt: string): string {
  const d = new Date(startedAt + (startedAt.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleTimeString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function parseTimestamp(startedAt: string): number {
  return new Date(startedAt + (startedAt.endsWith('Z') ? '' : 'Z')).getTime();
}

function roundTo5Min(timestamp: number, direction: 'floor' | 'ceil'): number {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const hour = d.getHours();
  const min = d.getMinutes();
  const roundedMin = direction === 'floor' ? Math.floor(min / 5) * 5 : Math.ceil(min / 5) * 5;
  return new Date(year, month, day, hour, roundedMin).getTime();
}

function PartyLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
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

function isDarkColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.35;
}

function formatTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function PartyTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string | number;
  mode: Mode;
}) {
  if (!active || !payload || !label) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const labelText = typeof label === 'number' ? formatTimeLabel(label) : label;

  return (
    <div className="rounded-xl border bg-card shadow-lg p-3 text-sm max-w-xs">
      <p className="font-bold text-muted-foreground text-xs mb-1.5 uppercase tracking-wide">
        {labelText}
      </p>
      {sorted.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/10"
              style={{ backgroundColor: entry.color }}
            />
            <span className="font-semibold truncate">{entry.name}</span>
          </div>
          <span className="tabular-nums font-bold text-right shrink-0">
            {mode === 'percent'
              ? `${entry.value.toFixed(1)}%`
              : mode === 'seats'
                ? `${entry.value.toFixed(0)} seat${entry.value === 1 ? '' : 's'}`
                : entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Trends() {
  const { data } = usePartyVoteHistory();
  const [selectedParties, setSelectedParties] = useState<Set<string>>(
    new Set()
  );
  const [mode, setMode] = useState<Mode>('seats');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (data && data.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      const latest = data[data.length - 1];
      const parliamentParties = new Set(
        latest.parties.filter((p) => p.seats > 0).map((p) => p.party)
      );
      if (parliamentParties.size === 0) {
        setSelectedParties(new Set(ALL_PARTIES.slice(0, 4)));
      } else {
        setSelectedParties(parliamentParties);
      }
    }
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((point) => {
      const total = point.parties.reduce((s, p) => s + p.votes, 0);
      const row: Record<string, number | string> = {
        time: formatDate(point.startedAt),
        timestamp: parseTimestamp(point.startedAt),
      };
      for (const p of point.parties) {
        row[`party:Votes:${p.party}`] = p.votes;
        row[`party:Pct:${p.party}`] = total > 0 ? (p.votes / total) * 100 : 0;
        row[`party:Seats:${p.party}`] = p.seats;
      }
      return row;
    });
  }, [data]);

  const { ticks, domain } = useMemo(() => {
    if (chartData.length === 0) return { ticks: [], domain: ['auto', 'auto'] as [number | string, number | string] };
    const timestamps = chartData.map((d) => d.timestamp as number);
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    const start = roundTo5Min(min, 'floor');
    const end = roundTo5Min(max, 'ceil');
    const interval = 5 * 60 * 1000;
    const tickList: number[] = [];
    for (let t = start; t <= end; t += interval) {
      tickList.push(t);
    }
    const domainValue: [number, number] = min === max ? [min - interval, max + interval] : [min, max];
    return { ticks: tickList, domain: domainValue };
  }, [chartData]);

  const toggleParty = useCallback((party: string) => {
    setSelectedParties((prev) => {
      const next = new Set(prev);
      if (next.has(party)) {
        next.delete(party);
      } else {
        next.add(party);
      }
      return next;
    });
  }, []);

  const hasData =
    data &&
    data.length >= 2 &&
    data.some((point) => point.parties.length > 0);

  if (!hasData) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-1">Trends</h1>
        <div className="h-1 w-12 bg-gradient-brand rounded-full mb-2" />
        <WaitingState context="trends" title="Waiting for more results" />
      </div>
    );
  }

  const dataKeyPrefix =
    mode === 'votes' ? 'party:Votes:' : mode === 'seats' ? 'party:Seats:' : 'party:Pct:';

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Trends</h1>
        <div className="h-1 w-16 bg-gradient-brand rounded-full mt-1.5" />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground font-semibold">
          Party {mode === 'seats' ? 'seat totals' : 'vote totals'} over time.
        </p>

        <div className="flex rounded-full border border-border p-0.5 bg-muted/50">
          <button
            onClick={() => setMode('votes')}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-bold tracking-wide transition-colors',
              mode === 'votes'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            # Votes
          </button>
          <button
            onClick={() => setMode('percent')}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-bold tracking-wide transition-colors',
              mode === 'percent'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            % of Vote
          </button>
          <button
            onClick={() => setMode('seats')}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-bold tracking-wide transition-colors',
              mode === 'seats'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            # Seats
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ALL_PARTIES.map((party) => (
          <button
            key={party}
            onClick={() => toggleParty(party)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-bold tracking-wide transition-colors border',
              selectedParties.has(party)
                ? 'text-white border-transparent shadow-sm ring-1 ring-white/40'
                : 'bg-background text-muted-foreground hover:text-foreground border-border'
            )}
            style={
              selectedParties.has(party)
                ? { backgroundColor: partyColors[party] || '#666' }
                : undefined
            }
          >
            {party}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={domain}
              ticks={ticks}
              tick={{ fontSize: 11 }}
              tickFormatter={formatTimeLabel}
              stroke="hsl(var(--muted-foreground))"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="hsl(var(--muted-foreground))"
              tickLine={false}
              tickFormatter={
                mode === 'votes'
                  ? (v: number) =>
                      v >= 1_000_000
                        ? `${(v / 1_000_000).toFixed(1)}M`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}k`
                          : v.toLocaleString()
                  : mode === 'seats'
                    ? (v: number) => v.toLocaleString()
                    : (v: number) => `${v.toFixed(1)}%`
              }
            />
            <Tooltip content={<PartyTooltip mode={mode} />} />
            <Legend content={<PartyLegend />} />
            {ALL_PARTIES.filter((p) => selectedParties.has(p)).map((party) => {
              const color = partyColors[party] || '#8884d8';
              const dark = isDarkColor(color);
              return (
                <Line
                  key={party}
                  type="monotone"
                  dataKey={`${dataKeyPrefix}${party}`}
                  name={party}
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


    </div>
  );
}
