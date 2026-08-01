import { useSortable } from '@dnd-kit/react/sortable';
import { cn } from '../lib/utils.js';
import { partyColors } from '../lib/constants.js';
import type { PartyEntry } from '../lib/parliament.js';

export function SortableRow({
  party,
  totalPartyVotes,
  index,
  hoveredParty,
  onHoveredPartyChange,
}: {
  party: PartyEntry;
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
        'border-b last:border-0 transition-colors',
        isHovered && !isDragging ? 'bg-muted/40' : 'hover:bg-muted/30',
        isDragging && 'opacity-50',
        isDropTarget && !isDragging && 'border-t-2 border-brand'
      )}
    >
      <td className="py-2 sm:py-3 pr-4 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2.5 h-2.5 sm:w-3 sm:h-3 flex-shrink-0 ring-1 ring-foreground/15"
            style={{
              backgroundColor: partyColors[party.candidate] || '#666',
            }}
          />
          <span className="font-bold truncate min-w-0">{party.candidate}</span>
        </div>
      </td>
      <td className="text-right px-2 tabular-nums font-semibold whitespace-nowrap">
        <span className="hidden sm:inline">{party.votes.toLocaleString()} </span>
        <span className="text-muted-foreground text-xs font-normal sm:ml-1.5">
          {((party.votes / totalPartyVotes) * 100).toFixed(1)}%
        </span>
      </td>
      <td className="text-right px-2 tabular-nums font-semibold hidden sm:table-cell">
        {party.electorateSeats}
      </td>
      <td className="text-right px-2 tabular-nums font-semibold hidden sm:table-cell">
        {party.listSeats}
      </td>
      <td className="text-right pl-2 font-extrabold tabular-nums">
        {party.seats}
      </td>
    </tr>
  );
}
