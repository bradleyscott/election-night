import { useSortable } from '@dnd-kit/react/sortable';
import { cn } from '../lib/utils.js';
import { partyColor } from '../lib/constants.js';
import { NUMERIC, NUMERIC_CELL, TR_ROW } from './Table.js';
import { PartyDot } from './PartyDot.js';
import type { PartyVoteResult } from '@election-night/core/types';

export function SortableRow({
  party,
  totalPartyVotes,
  index,
  hoveredParty,
  onHoveredPartyChange,
}: {
  party: PartyVoteResult;
  totalPartyVotes: number;
  index: number;
  hoveredParty: string | null;
  onHoveredPartyChange: (party: string | null) => void;
}) {
  const { ref, isDragging, isDropTarget } = useSortable({
    id: party.candidate,
    index,
  });
  const isHovered = hoveredParty === party.candidate;

  return (
    <tr
      ref={ref}
      onMouseEnter={() => onHoveredPartyChange(party.candidate)}
      onMouseLeave={() => onHoveredPartyChange(null)}
      className={cn(
        TR_ROW,
        isHovered && !isDragging ? 'bg-muted/40' : 'hover:bg-muted/30',
        isDragging && 'opacity-50',
        isDropTarget && !isDragging && 'border-t-2 border-brand'
      )}
    >
      <td className="py-2 sm:py-3 pr-4 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <PartyDot
            color={partyColor(party.candidate)}
            size="md"
            className="sm:h-3 sm:w-3"
          />
          <span className="font-bold truncate min-w-0">{party.candidate}</span>
        </div>
      </td>
      <td className={cn('px-2 font-semibold', NUMERIC, NUMERIC_CELL)}>
        <span className="hidden sm:inline">
          {party.votes.toLocaleString()}{' '}
        </span>
        <span className="text-muted-foreground text-sm font-normal sm:ml-1.5">
          {((party.votes / totalPartyVotes) * 100).toFixed(1)}%
        </span>
      </td>
      <td
        className={cn(
          'px-2 font-semibold hidden sm:table-cell',
          NUMERIC,
          NUMERIC_CELL
        )}
      >
        {party.electorateSeats}
      </td>
      <td
        className={cn(
          'px-2 font-semibold hidden sm:table-cell',
          NUMERIC,
          NUMERIC_CELL
        )}
      >
        {party.listSeats}
      </td>
      <td className={cn('pl-2 font-extrabold', NUMERIC, NUMERIC_CELL)}>
        {party.seats}
      </td>
    </tr>
  );
}
