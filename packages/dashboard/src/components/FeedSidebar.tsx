import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFeed } from '../hooks/useFeed.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from './WaitingState.js';
import type { FeedEvent } from '@election-night/core/types';

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_CONFIG: Record<
  string,
  { label: string; dotClass: string; ringClass: string }
> = {
  result_updated: {
    label: 'Updated',
    dotClass: 'bg-blue-700 dark:bg-blue-400',
    ringClass: 'ring-blue-700/20 dark:ring-blue-400/25',
  },
  prediction_called: {
    label: 'Prediction',
    dotClass: 'bg-green-700 dark:bg-green-400',
    ringClass: 'ring-green-700/20 dark:ring-green-400/25',
  },
  leader_change: {
    label: 'Leader Change',
    dotClass: 'bg-amber-600 dark:bg-amber-400',
    ringClass: 'ring-amber-600/25 dark:ring-amber-400/30',
  },
  count_completed: {
    label: 'Complete',
    dotClass: 'bg-green-700 dark:bg-green-400',
    ringClass: 'ring-green-700/20 dark:ring-green-400/25',
  },
};

function SidebarEvent({ event }: { event: FeedEvent }) {
  const config = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.result_updated;
  const d = event.diff;

  return (
      <div className="flex gap-2 py-1.5">
      <div
        className={cn(
          'w-2 h-2 rounded-full ring-[2px] mt-1.5 shrink-0',
          config.dotClass,
          config.ringClass
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link
            to={`/electorates/${encodeURIComponent(event.electorateName)}`}
            className="font-display text-[15px] font-bold hover:underline truncate"
          >
            {event.electorateName}
          </Link>
          <span className="chip-print chip-print--ink leading-none">
            {config.label}
          </span>
        </div>
        {event.commentary && (
          <p className="text-sm text-foreground/70 mt-0.5 leading-snug">
            {event.commentary}
          </p>
        )}
        <div className="font-mono text-[11px] text-muted-foreground/70 mt-0.5">
          {(d.currentPercentageCounted * 100).toFixed(0)}% counted ·{' '}
          {d.currentMargin.toLocaleString()} vote lead ·{' '}
          {relativeTime(event.timestamp)}
        </div>
      </div>
    </div>
  );
}

export default function FeedSidebar({
  electorateName,
}: {
  electorateName?: string;
}) {
  const { feedEvents } = useFeed();

  const filteredEvents = useMemo(() => {
    let events = feedEvents;
    if (electorateName) {
      events = events.filter(
        (e) =>
          e.electorateName.toLowerCase() === electorateName.toLowerCase()
      );
    }
    return events.slice(0, 30);
  }, [feedEvents, electorateName]);

  return (
    <aside className="w-64 lg:w-72 h-full bg-background border-l border-border flex flex-col">
      <div className="sticky top-0 bg-background z-10 px-4 pt-4 pb-2 border-b border-border">
        <Link
          to="/feed"
          className="font-label text-[11px] font-bold tracking-[0.09em] uppercase text-foreground hover:text-brand transition-colors"
        >
          Live Feed
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filteredEvents.length === 0 ? (
          feedEvents.length === 0
            ? <WaitingState variant="inline" context="sidebar" />
            : <p className="text-xs text-muted-foreground font-semibold py-4 text-center">No matching events yet.</p>
        ) : (
          <div className="space-y-0">
            {filteredEvents.map((event) => (
              <SidebarEvent key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
