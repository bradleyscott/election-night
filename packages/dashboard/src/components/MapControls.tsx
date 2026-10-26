import { Link } from 'react-router-dom';
import { ElectorateSearch } from './ElectorateSearch.js';
import { Toggle } from './Toggle.js';

interface MapControlsProps {
  /** Seat names the search offers — the same list the map is drawing. */
  names: string[];
  showMaori: boolean;
  onShowMaoriChange: (maori: boolean) => void;
  /** Clear returns to the landing state, so it only exists while a seat is open. */
  showClear?: boolean;
}

/**
 * The map's own controls — seat search, the General/Māori switch and Clear —
 * as a row inside the map card, above the map. They act on the panel below
 * them, not on the page, so they sit in the panel: the header stays a title.
 *
 * On a phone the same markup wraps to the two rows it already used: the search
 * takes the first, the switch and Clear share the second.
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
  showClear = false,
}: MapControlsProps) {
  return (
    <div className="relative z-[1100] flex flex-wrap items-center gap-2 border-b px-2 py-2 sm:px-3 sm:py-1.5">
      <ElectorateSearch names={names} />
      <Toggle
        options={[
          { value: 'general', label: 'General' },
          { value: 'maori', label: 'Māori' },
        ]}
        value={showMaori ? 'maori' : 'general'}
        onChange={(v) => onShowMaoriChange(v === 'maori')}
      />
      {showClear && (
        <Link
          to="/electorates"
          aria-label="Clear seat selection"
          className="ml-auto text-sm text-muted-foreground hover:text-foreground transition-colors px-2 min-h-[44px] flex items-center font-bold"
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          <span className="hidden sm:inline">Clear</span>
        </Link>
      )}
    </div>
  );
}
