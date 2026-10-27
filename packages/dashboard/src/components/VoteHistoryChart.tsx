import { useMemo, useState } from 'react';
import {
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ElectorateHistoryPoint } from '../lib/history-types.js';
import { partyColor } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
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
  formatVotes,
  parseDbTimestamp,
  timeTicks,
} from '../lib/chart-format.js';
import { CountedTape } from './CountedTape.js';
import { PartyLine } from './PartyLine.js';
import type { TapePoint } from './CountedTape.js';
import { PartyDot } from './PartyDot.js';
import { Toggle } from './Toggle.js';

type ChartMode = 'votes' | 'percentage' | 'candidateVotes' | 'counted';

/** The modes the seat chart offers, in toggle order. */
const MODE_OPTIONS: { value: ChartMode; label: string }[] = [
  { value: 'votes', label: '# Votes' },
  { value: 'percentage', label: '% of Vote' },
  { value: 'counted', label: 'Counted' },
];

type ChartProps = {
  history: ElectorateHistoryPoint[];
  mode?: ChartMode;
  showParty?: boolean;
  className?: string;
  /**
   * The seat's voting places, for the receipt rug under the Counted tape: the
   * count only ever moves when a place lands, so the ticks are the same series
   * at a finer resolution. Absent on an archived cycle, or before any place
   * reports, and the tape simply draws without a rug.
   */
  votingPlaces?: { counted: number; total: number; receipts: number[] };
};

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
  mode: Exclude<ChartMode, 'counted'>;
}) {
  if (!active || !payload || !label) return null;

  const labelStr = formatTooltipStamp(Number(label));

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
              <PartyDot color={entry.color} />
              <span className="font-semibold truncate">{entry.name}</span>
            </div>
            <span className="tabular-nums font-bold text-right shrink-0">
              {mode === 'percentage'
                ? formatPercent(entry.value * 100)
                : formatVotes(entry.value)}
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
          const color = entry.color ?? partyColor(entry.party);
          return (
            <div key={entry.name} className="flex items-center gap-1.5">
              <PartyDot color={color} size="md" />
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
  votingPlaces,
}: ChartProps) {
  const [chartMode, setChartMode] = useState<ChartMode>(mode);

  // The Counted series is the share of the seat's voting places counted, so the
  // rug of receipts below the axis is the same measure at a finer resolution.
  const countedPoints = useMemo<TapePoint[]>(() => {
    return history.map((point) => ({
      t: parseDbTimestamp(point.startedAt),
      value: point.votePctCounted * 100,
      sub:
        point.votesCounted > 0
          ? `${point.votesCounted.toLocaleString()} votes`
          : undefined,
    }));
  }, [history]);

  const chartData = useMemo(() => {
    return history.map((point) => {
      const total = point.votesCounted || 1;
      const ts = parseDbTimestamp(point.startedAt);
      const row: Record<string, number | string> = {
        ts,
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

  // Same tick spacing the drawn tape uses, so the axis does not change voice
  // when the mode does.
  const xTicks = useMemo(() => {
    if (history.length < 2) return [];
    return timeTicks(
      parseDbTimestamp(history[0].startedAt),
      parseDbTimestamp(history[history.length - 1].startedAt)
    );
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
    <div className={cn('border p-3 sm:p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="kicker">{chartTitle}</div>
        <Toggle
          options={MODE_OPTIONS}
          value={chartMode}
          onChange={setChartMode}
        />
      </div>
      {chartMode === 'counted' ? (
        <CountedTape
          points={countedPoints}
          receipts={votingPlaces?.receipts}
          yTicks={[0, 25, 50, 75, 100]}
          formatTick={formatPercentAxis}
          formatValue={formatPercent}
          height={280}
          label="Votes counted"
          note={
            votingPlaces
              ? `${votingPlaces.counted} / ${votingPlaces.total} places`
              : undefined
          }
        />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray={GRID_DASH}
              stroke={GRID_STROKE}
              verticalPoints={xTicks.length > 0 ? xTicks : undefined}
            />
            <XAxis
              dataKey="ts"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={xTicks}
              tickFormatter={formatClock}
              tick={AXIS_TICK}
              stroke={AXIS_STROKE}
              tickLine={false}
            />
            <YAxis
              tick={AXIS_TICK}
              stroke={AXIS_STROKE}
              tickLine={false}
              domain={['auto', 'auto']}
              tickFormatter={
                chartMode === 'percentage'
                  ? (v: number) => formatPercentAxis(v * 100)
                  : formatVoteAxis
              }
            />
            <Tooltip content={<VoteChartTooltip mode={chartMode} />} />
            {entities.map((e) => {
              return (
                <PartyLine
                  key={e.name}
                  dataKey={`${prefix}${e.name}`}
                  name={e.name}
                  color={partyColor(e.party)}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
      {chartMode === 'counted' ? null : <VoteChartLegend entities={entities} />}
    </div>
  );
}
