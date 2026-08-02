import { useRef } from 'react';
import { cn } from '../lib/utils.js';
import type { SeatInfo } from '../lib/parliament.js';

const ROWS = 3;

export function ParliamentSeatGrid({
  seats,
  draggingParty,
  dropTargetParty,
  hoveredParty,
  selectedSeat,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onHover,
  onSelect,
}: {
  seats: SeatInfo[];
  draggingParty: string | null;
  dropTargetParty: string | null;
  hoveredParty: string | null;
  selectedSeat: number | null;
  onDragStart: (party: string) => void;
  onDragEnter: (party: string) => void;
  onDragEnd: () => void;
  onDrop: (draggedParty: string, targetParty: string) => void;
  onHover: (party: string | null) => void;
  onSelect: (index: number, element: HTMLElement) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="overflow-x-auto pt-3"
      onDragLeave={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        ) {
          onHover(null);
        }
      }}
    >
      <div
        ref={gridRef}
        data-seat-grid
        className="grid gap-px sm:gap-0.5 min-w-[480px] select-none"
        style={{
          gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${ROWS}, auto)`,
          gridAutoColumns: '1fr',
        }}
      >
        {seats.map((s, i) => {
          const isDragging = draggingParty === s.party;
          const isDropTarget = dropTargetParty === s.party && !isDragging;
          const isHovered = hoveredParty === s.party && !draggingParty;
          const isSelected = selectedSeat === i && s.party !== 'Vacant';

          return (
            <div
              key={`${s.party}-${i}`}
              draggable
              onDragStart={() => onDragStart(s.party)}
              onDragEnter={() => onDragEnter(s.party)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingParty && draggingParty !== s.party) {
                  onDrop(draggingParty, s.party);
                }
              }}
              onDragEnd={onDragEnd}
              onMouseEnter={() => onHover(s.party)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => {
                if (s.party !== 'Vacant') {
                  onSelect(i, e.currentTarget);
                }
              }}
              className={cn(
                'aspect-square transition-opacity duration-100',
                isDragging && 'opacity-50 ring-2 ring-foreground/60',
                isDropTarget && 'ring-2 ring-brand',
                isHovered && 'ring-2 ring-foreground/50 z-10',
                isSelected && 'ring-2 ring-foreground z-20',
                !isDragging &&
                  !isDropTarget &&
                  !isHovered &&
                  !isSelected &&
                  'ring-1 ring-foreground/15',
                s.type === 'electorate' ? 'cursor-pointer' : 'cursor-move'
              )}
              style={{
                backgroundColor: s.color,
                opacity: s.opacity,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
