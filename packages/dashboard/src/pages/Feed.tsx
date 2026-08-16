import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFeed } from '../hooks/useFeed.js';
import { cn } from '../lib/utils.js';
import { relativeTime, formatClockTime } from '../lib/feed.js';
import { TimelineItem, TimelineGroupHeader } from '../components/Timeline.js';
import { WaitingState } from '../components/WaitingState.js';
import type { FeedEvent } from '@election-night/core/types';

function timeBucket(timestamp: number): number {
  return Math.floor(timestamp / 10000) * 10000;
}

const TYPE_CONFIG: Record<string, { label: string; dotColor: 'blue' | 'green' | 'amber'; textColor: string }> = {
  result_updated: {
    label: 'Updated',
    dotColor: 'blue',
    textColor: 'text-blue-700 dark:text-blue-400',
  },
  prediction_called: {
    label: 'Prediction',
    dotColor: 'green',
    textColor: 'text-green-700 dark:text-green-400',
  },
  leader_change: {
    label: 'Leader Change',
    dotColor: 'amber',
    textColor: 'text-amber-700 dark:text-amber-400',
  },
  count_completed: {
    label: 'Count Complete',
    dotColor: 'green',
    textColor: 'text-green-700 dark:text-green-400',
  },
};

function linkifyElectorate(text: string, electorateName: string) {
  const parts = text.split(
    new RegExp(`(${electorateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  );
  return parts.map((part, i) =>
    part.toLowerCase() === electorateName.toLowerCase() ? (
      <Link
        key={i}
        to={`/electorates/${encodeURIComponent(electorateName)}`}
        className="font-semibold underline underline-offset-2 decoration-1 decoration-muted-foreground/30 hover:decoration-foreground transition-colors"
      >
        {part}
      </Link>
    ) : (
      part
    )
  );
}

function EventContent({ event }: { event: FeedEvent }) {
  const typeConfig = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.result_updated;
  const d = event.diff;
  const percentageDelta =
    d.previousPercentageCounted !== null
      ? (d.currentPercentageCounted - d.previousPercentageCounted) * 100
      : null;

  return (
    <>
      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground font-semibold mb-px">
        <span className={cn('font-bold tracking-wide uppercase', typeConfig.textColor)}>
          {typeConfig.label}
        </span>
      </div>

      <Link
        to={`/electorates/${encodeURIComponent(event.electorateName)}`}
        className="font-display font-bold text-base hover:underline transition-colors"
      >
        {event.electorateName}
      </Link>

      {event.commentary && (
        <p className="text-sm text-foreground/80 mt-0.5 leading-snug">
          {linkifyElectorate(event.commentary, event.electorateName)}
        </p>
      )}

      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-sm text-muted-foreground font-medium">
        <span>
          {(d.currentPercentageCounted * 100).toFixed(0)}% votes counted
          {percentageDelta !== null && percentageDelta !== 0 && (
            <span className="text-blue-700 dark:text-blue-400 ml-0.5">
              ({percentageDelta > 0 ? '+' : ''}
              {percentageDelta.toFixed(1)}%)
            </span>
          )}
        </span>
        <span>
          · {d.currentMargin.toLocaleString()} vote lead ({(d.currentMarginPercent * 100).toFixed(2)}%)
        </span>
        <span>
          · ±{(event.marginOfError * 100).toFixed(1)}% MoE
        </span>
      </div>
    </>
  );
}

function FilterBar({
  activeFilter,
  onFilterChange,
  counts,
}: {
  activeFilter: string;
  onFilterChange: (f: string) => void;
  counts: Record<string, number>;
}) {
  const filters = [
    { value: 'all', label: 'All' },
    { value: 'count_completed', label: 'Count Complete' },
    { value: 'prediction_called', label: 'Predictions' },
    { value: 'leader_change', label: 'Leader Changes' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4">
      {filters.map((f) => {
        const count = counts[f.value] ?? 0;
        const disabled = f.value !== 'all' && count === 0;
        return (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            disabled={disabled}
            className={cn(
              'chip-print transition-colors',
              disabled && 'hidden',
              activeFilter === f.value
                ? 'bg-foreground text-background border-foreground'
                : 'hover:bg-muted/40'
            )}
          >
            {f.label}
            {count > 0 && (
              <span className="ml-1.5 opacity-60 font-mono">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function Feed() {
  const { feedEvents } = useFeed();
  const [activeFilter, setActiveFilter] = useState('all');

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return feedEvents;
    return feedEvents.filter((e) => e.type === activeFilter);
  }, [feedEvents, activeFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: feedEvents.length };
    for (const f of feedEvents) {
      c[f.type] = (c[f.type] || 0) + 1;
    }
    return c;
  }, [feedEvents]);

  const grouped = useMemo(() => {
    const map = new Map<number, FeedEvent[]>();
    for (const event of filtered) {
      const bucket = timeBucket(event.timestamp);
      const group = map.get(bucket) ?? [];
      group.push(event);
      map.set(bucket, group);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b - a);
  }, [filtered]);

  if (feedEvents.length === 0) {
    return (
      <div className="animate-fade-in">
        <div className="pagehead">
          <h1>Feed</h1>
        </div>
        <WaitingState context="feed" />
      </div>
    );
  }

  return (
    <div>
      <div className="pagehead">
        <h1>Feed</h1>
      </div>

      <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} counts={counts} />

      <div className="mt-4">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground font-semibold py-8 text-center">
            No {activeFilter === 'all' ? '' : 'matching '}events yet.
          </p>
        ) : (
          grouped.map(([bucket, events], groupIndex) => (
            <div key={bucket} className="opacity-0 animate-fade-in" style={{ animationDelay: `${groupIndex * 0.08}s` }}>
              <TimelineGroupHeader label={relativeTime(bucket)} time={formatClockTime(bucket)} />
              {events.map((event, itemIndex) => (
                <TimelineItem
                  key={event.id}
                  dotColor={TYPE_CONFIG[event.type]?.dotColor ?? 'blue'}
                  isLast={itemIndex === events.length - 1}
                >
                  <EventContent event={event} />
                </TimelineItem>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
