import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { usePartyVoteHistory } from '../hooks/useVoteHistory.js';
import {
  canonicalPartyName,
  orderParties,
  partyColor,
} from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from '../components/WaitingState.js';
import {
  AXIS_STROKE,
  AXIS_TICK,
  GRID_DASH,
  GRID_STROKE,
  formatClock,
  formatPercent,
  formatPercentAxis,
  formatTooltipStamp,
  formatVoteAxis,
  parseDbTimestamp,
  timeTicks,
} from '../lib/chart-format.js';
import { CountedTape } from '../components/CountedTape.js';
import { PartyLine } from '../components/PartyLine.js';
import type { TapePoint } from '../components/CountedTape.js';

type Mode = 'votes' | 'percent' | 'seats' | 'counted';

function PartyLegend({
  payload,
}: {
  payload?: Array<{ value: string; color: string }>;
}) {
  if (!payload || payload.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 justify-center mt-2">
      {payload.map((entry) => {
        return (
          <div key={entry.value} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 shrink-0 ring-1 ring-foreground/20"
              style={{ backgroundColor: entry.color }}
            />
            <span className="font-label text-xs font-semibold text-foreground">
              {entry.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PartyTooltip({
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
    payload?: Record<string, unknown>;
  }[];
  label?: string | number;
  mode: Exclude<Mode, 'counted'>;
}) {
  if (!active || !payload || !label) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const labelText =
    typeof label === 'number' ? formatTooltipStamp(label) : label;

  return (
    <div className="border bg-popover p-3 text-sm max-w-xs">
      <p className="font-label font-bold text-muted-foreground text-xs mb-1.5 uppercase tracking-wide">
        {labelText}
      </p>
      {sorted.map((entry) => (
        <div
          key={entry.name}
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
            {mode === 'percent'
              ? formatPercent(entry.value)
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

  // Chips follow the parties present in the history, under their current
  // names, ordered by the fixed editorial order. A static colour map would
  // show a dead chip for a party this cycle does not have, and no chip for one
  // whose label the feed renamed; the chart series below are keyed by the
  // canonical name too, so a renamed party keeps one chip and one line.
  const partyOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const point of data ?? []) {
      for (const p of point.parties) seen.add(canonicalPartyName(p.party));
    }
    return orderParties([...seen]);
  }, [data]);

  useEffect(() => {
    if (data && data.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      const latest = data[data.length - 1];
      const parliamentParties = new Set(
        latest.parties
          .filter((p) => p.seats > 0)
          .map((p) => canonicalPartyName(p.party))
      );
      setSelectedParties(
        parliamentParties.size > 0
          ? parliamentParties
          : new Set(
              orderParties(latest.parties.map((p) => p.party)).slice(0, 4)
            )
      );
    }
  }, [data]);

  const visibleParties = partyOptions.filter((p) => selectedParties.has(p));

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((point) => {
      const total = point.parties.reduce((s, p) => s + p.votes, 0);
      const row: Record<string, number | string> = {
        timestamp: parseDbTimestamp(point.startedAt),
      };
      for (const p of point.parties) {
        // A renamed party keeps its rows under the current name, so a series
        // does not lose the votes it won under the old spelling.
        const name = canonicalPartyName(p.party);
        row[`party:Votes:${name}`] =
          Number(row[`party:Votes:${name}`] ?? 0) + p.votes;
        row[`party:Pct:${name}`] = total > 0 ? (p.votes / total) * 100 : 0;
        row[`party:Seats:${name}`] =
          Number(row[`party:Seats:${name}`] ?? 0) + p.seats;
      }
      return row;
    });
  }, [data]);

  // The national Counted series: share of the vote counted, per scrape, on the
  // same denominator the seat panel uses. The country reports totals rather
  // than places, so this tape has no rug.
  const countedPoints = useMemo<TapePoint[]>(() => {
    return (data ?? []).map((point) => ({
      t: parseDbTimestamp(point.startedAt),
      value: point.votePctCounted * 100,
      sub:
        point.votesCounted > 0
          ? `${point.votesCounted.toLocaleString()} votes`
          : undefined,
    }));
  }, [data]);

  const { ticks, domain } = useMemo(() => {
    if (chartData.length === 0)
      return {
        ticks: [],
        domain: ['auto', 'auto'] as [number | string, number | string],
      };
    const timestamps = chartData.map((d) => d.timestamp as number);
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    const interval = 5 * 60 * 1000;
    const domainValue: [number, number] =
      min === max ? [min - interval, max + interval] : [min, max];
    return { ticks: timeTicks(min, max, 8), domain: domainValue };
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
    (data.some((point) => point.parties.length > 0) ||
      data.some((point) => point.votesCounted > 0));

  if (!hasData) {
    return (
      <div className="animate-fade-in">
        <div className="pagehead">
          <h1>Trends</h1>
        </div>
        <WaitingState context="trends" title="Waiting for more results" />
      </div>
    );
  }

  const dataKeyPrefix =
    mode === 'votes'
      ? 'party:Votes:'
      : mode === 'seats'
        ? 'party:Seats:'
        : 'party:Pct:';

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="pagehead">
        <h1>Trends</h1>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground font-semibold">
          {mode === 'counted'
            ? 'Vote count progress over time.'
            : `Party ${mode === 'seats' ? 'seat totals' : mode === 'percent' ? 'vote share' : 'vote totals'} over time.`}
        </p>

        <div className="flex flex-wrap border border-border">
          <button
            onClick={() => setMode('votes')}
            className={cn(
              'px-3 py-1.5 font-label text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              mode === 'votes'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            # Votes
          </button>
          <button
            onClick={() => setMode('percent')}
            className={cn(
              'px-3 py-1.5 font-label text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              mode === 'percent'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            % of Vote
          </button>
          <button
            onClick={() => setMode('seats')}
            className={cn(
              'px-3 py-1.5 font-label text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              mode === 'seats'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            # Seats
          </button>
          <button
            onClick={() => setMode('counted')}
            className={cn(
              'px-3 py-1.5 font-label text-sm font-semibold tracking-wide transition-colors border-r border-border last:border-r-0',
              mode === 'counted'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            Counted
          </button>
        </div>
      </div>

      {mode !== 'counted' && (
        <div className="flex flex-wrap gap-1.5">
          {partyOptions.map((party) => (
            <button
              key={party}
              onClick={() => toggleParty(party)}
              className={cn(
                'chip-print transition-colors',
                selectedParties.has(party)
                  ? 'border-foreground/40 bg-foreground/5'
                  : 'hover:bg-muted/40'
              )}
            >
              <span
                className="inline-block w-2 h-2 ring-1 ring-foreground/25 shrink-0"
                style={{ backgroundColor: partyColor(party) }}
              />
              {party}
            </button>
          ))}
        </div>
      )}

      <div className="border p-3 sm:p-4">
        {mode === 'counted' ? (
          <CountedTape
            points={countedPoints}
            yTicks={[0, 25, 50, 75, 100]}
            formatTick={formatPercentAxis}
            formatValue={formatPercent}
            height={400}
            label="Counted"
            emptyLabel="No count yet"
          />
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray={GRID_DASH} stroke={GRID_STROKE} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={domain}
                ticks={ticks}
                tick={AXIS_TICK}
                tickFormatter={formatClock}
                stroke={AXIS_STROKE}
                tickLine={false}
              />
              <YAxis
                tick={AXIS_TICK}
                stroke={AXIS_STROKE}
                tickLine={false}
                domain={['auto', 'auto']}
                tickFormatter={
                  mode === 'votes'
                    ? formatVoteAxis
                    : mode === 'seats'
                      ? (v: number) => v.toLocaleString()
                      : formatPercentAxis
                }
              />
              <Tooltip content={<PartyTooltip mode={mode} />} />
              <Legend content={<PartyLegend />} />
              {visibleParties.map((party) => (
                <PartyLine
                  key={party}
                  dataKey={`${dataKeyPrefix}${party}`}
                  name={party}
                  color={partyColor(party)}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
