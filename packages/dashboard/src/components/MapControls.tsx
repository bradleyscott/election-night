import { useEffect, useRef, useState } from 'react';
import { ElectorateSearch } from './ElectorateSearch.js';
import { Toggle } from './Toggle.js';
import { cn } from '../lib/utils.js';

interface MapControlsProps {
  /** Seat names the search offers — the same list the map is drawing. */
  names: string[];
  showMaori: boolean;
  onShowMaoriChange: (maori: boolean) => void;
  /** The open seat, if any. With one open the controls float over the map. */
  selectedName?: string | null;
}

/**
 * The map's own controls — seat search and the General/Māori switch — either
 * as a hairline row inside the map card or, once a seat is open, as a panel
 * floating over the map's top right. They act on the map below them, not on the
 * page, so they sit in the card: the header stays a title.
 *
 * With a seat open the row folds down to a single search button on the map
 * itself: the reader already has their seat and the map is the point, so the
 * field and the roll switch are one click away rather than always taking a
 * line. Opening a seat folds the panel back down, and so does choosing a name
 * or pressing Escape in the search, so the compact state is what a seat settles
 * into. There is no Clear control: clearing is what the Electorates nav entry,
 * the browser's back button and picking another seat already do, and a button
 * that only appeared in one state read as part of the search.
 *
 * `relative z-[1100]` is load-bearing. Leaflet's panes are absolutely positioned
 * at z-index 400 and its control corners (the zoom buttons) at 1000, in the
 * same stacking context, so a row left at `z-auto` paints its open search list
 * *underneath* the tiles — and anything below 1000 puts the list under the zoom
 * buttons instead.
 */
export function MapControls({
  names,
  showMaori,
  onShowMaoriChange,
  selectedName,
}: MapControlsProps) {
  const hasSeat = !!selectedName;
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // A newly opened seat folds the panel back down. Comparing the name (rather
  // than the presence of a seat) also folds it after a search picks another
  // seat, which keeps the open seat a single source of truth.
  useEffect(() => {
    setExpanded(false);
  }, [selectedName]);

  // A panel floating over the map closes when the reader goes back to the map
  // or anywhere else on the page, like any other popover. Without this a
  // floating panel would sit over the seat until the reader found the button
  // again.
  useEffect(() => {
    if (!expanded || !hasSeat) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded, hasSeat]);

  const showSearch = !hasSeat || expanded;

  return (
    <div
      ref={panelRef}
      className={cn(
        'z-[1100] flex flex-wrap items-center gap-2',
        hasSeat
          ? cn(
              'absolute top-2 right-2',
              // Anchored right and never reaching the left edge: Leaflet's
              // zoom buttons own that corner (top-left, ~34px wide plus its
              // 10px inset), so `4rem` of clearance keeps the open panel off
              // them on a phone as well as a desktop.
              showSearch &&
                'w-[calc(100%_-_4rem)] max-w-[24rem] border bg-background p-1.5'
            )
          : 'relative border-b px-2 py-2 sm:px-3 sm:py-1.5'
      )}
    >
      {hasSeat && (
        <button
          type="button"
          aria-expanded={showSearch}
          aria-label={
            showSearch ? 'Hide electorate search' : 'Search electorates'
          }
          onClick={() => setExpanded((open) => !open)}
          className={cn(
            'flex items-center gap-1.5 border bg-background font-label text-sm font-bold flex-shrink-0 min-h-[44px] py-2 sm:py-1.5 transition-colors hover:bg-muted',
            showSearch ? 'px-2' : 'px-3'
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className={showSearch ? 'sr-only' : 'inline'}>Search</span>
        </button>
      )}
      {showSearch && (
        <ElectorateSearch
          names={names}
          autoFocus={hasSeat}
          onSelect={() => setExpanded(false)}
          onDismiss={() => setExpanded(false)}
        />
      )}
      {showSearch && (
        <Toggle
          options={[
            { value: 'general', label: 'General' },
            { value: 'maori', label: 'Māori' },
          ]}
          value={showMaori ? 'maori' : 'general'}
          onChange={(v) => onShowMaoriChange(v === 'maori')}
        />
      )}
    </div>
  );
}
