import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFeed } from '../hooks/useFeed.js';
import { cn } from '../lib/utils.js';
import { feedEventStyle, relativeTime } from '../lib/feed.js';
import { WaitingState } from './WaitingState.js';
import type { FeedEvent } from '@election-night/core/types';

function SidebarEvent({ event }: { event: FeedEvent }) {
  const style = feedEventStyle(event.type);
  const d = event.diff;

  return (
    <div className="flex gap-2 py-1.5">
      <div
        className={cn(
          'w-2 h-2 rounded-full ring-[2px] mt-1.5 shrink-0',
          style.dot,
          style.ring
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
            {style.label}
          </span>
        </div>
        {event.commentary && (
          <p className="text-sm text-foreground/70 mt-0.5 leading-snug">
            {event.commentary}
          </p>
        )}
        <div className="font-mono text-[11px] text-muted-foreground/70 mt-0.5">
          {Math.round((event.progress ?? d.currentPercentageCounted) * 100)}%
          counted · {d.currentMargin.toLocaleString()} vote lead ·{' '}
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
        (e) => e.electorateName.toLowerCase() === electorateName.toLowerCase()
      );
    }
    // Newest first, as the Feed page orders them: the list is appended to, so
    // the newest events are at the end. Taking the first 30 showed the night's
    // opening events beside a count that had moved on.
    return events.slice(-30).reverse();
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
          feedEvents.length === 0 ? (
            <WaitingState variant="inline" context="sidebar" />
          ) : (
            <p className="text-xs text-muted-foreground font-semibold py-4 text-center">
              No matching events yet.
            </p>
          )
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
