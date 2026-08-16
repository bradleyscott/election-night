import { useRef, useState, useCallback } from 'react';
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
  const seatRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [keyboardDragIndex, setKeyboardDragIndex] = useState<number | null>(null);
  const [keyboardDropIndex, setKeyboardDropIndex] = useState<number | null>(null);

  const isKeyboardDragging = keyboardDragIndex !== null;

  const moveDropTarget = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (keyboardDropIndex === null) return;
      const max = seats.length - 1;
      let next = keyboardDropIndex;
      if (direction === 'up') next = Math.max(0, next - 1);
      if (direction === 'down') next = Math.min(max, next + 1);
      if (direction === 'left') next = Math.max(0, next - ROWS);
      if (direction === 'right') next = Math.min(max, next + ROWS);
      if (next !== keyboardDropIndex) {
        setKeyboardDropIndex(next);
        onDragEnter(seats[next].party);
      }
    },
    [keyboardDropIndex, seats, onDragEnter]
  );

  const startKeyboardDrag = useCallback(
    (index: number) => {
      const seat = seats[index];
      if (!seat || seat.party === 'Vacant') return;
      setKeyboardDragIndex(index);
      setKeyboardDropIndex(index);
      onDragStart(seat.party);
    },
    [seats, onDragStart]
  );

  const dropKeyboardDrag = useCallback(() => {
    if (
      keyboardDragIndex === null ||
      keyboardDropIndex === null ||
      keyboardDragIndex === keyboardDropIndex
    ) {
      setKeyboardDragIndex(null);
      setKeyboardDropIndex(null);
      onDragEnd();
      return;
    }
    const dragged = seats[keyboardDragIndex];
    const target = seats[keyboardDropIndex];
    if (dragged && target && dragged.party !== target.party) {
      onDrop(dragged.party, target.party);
    }
    setKeyboardDragIndex(null);
    setKeyboardDropIndex(null);
    onDragEnd();
  }, [keyboardDragIndex, keyboardDropIndex, seats, onDrop, onDragEnd]);

  const cancelKeyboardDrag = useCallback(() => {
    setKeyboardDragIndex(null);
    setKeyboardDropIndex(null);
    onDragEnd();
  }, [onDragEnd]);

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
          const isKeyboardDragSource = keyboardDragIndex === i;
          const isKeyboardDropTarget = keyboardDropIndex === i && isKeyboardDragging;
          const canDrag = s.party !== 'Vacant';

          return (
            <div
              key={`${s.party}-${i}`}
              ref={(el) => { seatRefs.current[i] = el; }}
              tabIndex={s.party === 'Vacant' ? -1 : 0}
              role="button"
              aria-roledescription={canDrag ? 'draggable seat' : 'seat'}
              aria-label={`${s.party} ${s.type} seat`}
              aria-grabbed={canDrag ? isKeyboardDragging && isKeyboardDragSource : undefined}
              aria-dropeffect={canDrag && isKeyboardDragging && !isKeyboardDragSource ? 'move' : undefined}
              draggable={canDrag}
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
              onKeyDown={(e) => {
                if (isKeyboardDragging) {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelKeyboardDrag();
                    return;
                  }
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    moveDropTarget(
                      e.key === 'ArrowUp'
                        ? 'up'
                        : e.key === 'ArrowDown'
                          ? 'down'
                          : e.key === 'ArrowLeft'
                            ? 'left'
                            : 'right'
                    );
                    return;
                  }
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    dropKeyboardDrag();
                    return;
                  }
                }

                if (!canDrag) return;

                if (e.key === ' ') {
                  e.preventDefault();
                  startKeyboardDrag(i);
                  return;
                }

                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSelect(i, e.currentTarget);
                }
              }}
              className={cn(
                'aspect-square transition-opacity duration-100 focus:outline-none focus:ring-2 focus:ring-ring/60 focus:z-10',
                (isDragging || isKeyboardDragSource) && 'opacity-50 ring-2 ring-foreground/60',
                (isDropTarget || isKeyboardDropTarget) && 'ring-2 ring-brand',
                isHovered && 'ring-2 ring-foreground/50 z-10',
                isSelected && 'ring-2 ring-foreground z-20',
                !isDragging &&
                  !isDropTarget &&
                  !isHovered &&
                  !isSelected &&
                  !isKeyboardDragSource &&
                  !isKeyboardDropTarget &&
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
