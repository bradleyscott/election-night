import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFeed } from '../hooks/useFeed.js';
import { cn } from '../lib/utils.js';
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
    dotClass: 'bg-blue-500',
    ringClass: 'ring-blue-500/20',
  },
  prediction_called: {
    label: 'Prediction',
    dotClass: 'bg-green-500',
    ringClass: 'ring-green-500/20',
  },
  leader_change: {
    label: 'Leader Change',
    dotClass: 'bg-amber-500',
    ringClass: 'ring-amber-500/20',
  },
  count_completed: {
    label: 'Complete',
    dotClass: 'bg-green-500',
    ringClass: 'ring-green-500/20',
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
        <div className="flex items-center gap-1 flex-wrap">
          <Link
            to={`/electorates/${encodeURIComponent(event.electorateName)}`}
            className="text-sm font-extrabold hover:underline truncate"
          >
            {event.electorateName}
          </Link>
          <span className="text-[10px] font-bold uppercase text-muted-foreground/60 px-1 py-0.5 rounded bg-muted leading-none whitespace-nowrap">
            {config.label}
          </span>
        </div>
        {event.commentary && (
          <p className="text-xs text-foreground/70 mt-0.5 leading-snug">
            {event.commentary}
          </p>
        )}
        <div className="text-[11px] text-muted-foreground/50 mt-0.5">
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
    <aside className="w-64 lg:w-72 h-full bg-background border-l border-border shadow-xl flex flex-col">
      <div className="sticky top-0 bg-background z-10 px-4 pt-4 pb-2">
        <h2 className="text-sm font-extrabold tracking-tight uppercase text-muted-foreground">
          Live Feed
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filteredEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground font-semibold py-4 text-center animate-pulse-soft">
            {feedEvents.length === 0
              ? 'Waiting for results…'
              : 'No matching events yet.'}
          </p>
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
