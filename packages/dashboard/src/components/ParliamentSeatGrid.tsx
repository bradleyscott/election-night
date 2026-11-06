import { useState, useCallback } from 'react';
import { cn } from '../lib/utils.js';
import { CHAMBER_ROWS, chamberLayout } from '../lib/chamber.js';
import type { SeatInfo } from '../lib/parliament.js';

export function ParliamentSeatGrid({
  seats,
  majority,
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
  majority: number;
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
  const [keyboardDragIndex, setKeyboardDragIndex] = useState<number | null>(
    null
  );
  const [keyboardDropIndex, setKeyboardDropIndex] = useState<number | null>(
    null
  );

  const isKeyboardDragging = keyboardDragIndex !== null;

  const moveDropTarget = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (keyboardDropIndex === null) return;
      const max = seats.length - 1;
      let next = keyboardDropIndex;
      // Index is still column * CHAMBER_ROWS + ring, so one step is the next
      // bench in and a whole column is one seat along the bench.
      if (direction === 'up') next = Math.max(0, next - 1);
      if (direction === 'down') next = Math.min(max, next + 1);
      if (direction === 'left') next = Math.max(0, next - CHAMBER_ROWS);
      if (direction === 'right') next = Math.min(max, next + CHAMBER_ROWS);
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

  // Percentages of the reference frame, so the room scales with its container
  // and nothing has to be measured after paint.
  const layout = chamberLayout(seats.length);
  const x = (v: number) => `${(v / layout.width) * 100}%`;
  const y = (v: number) => `${(v / layout.height) * 100}%`;

  return (
    <div
      className="relative mx-auto w-full max-w-[704px] select-none"
      style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
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
      {seats.map((s, i) => {
        const isDragging = draggingParty === s.party;
        const isDropTarget = dropTargetParty === s.party && !isDragging;
        const isHovered = hoveredParty === s.party && !draggingParty;
        const isSelected = selectedSeat === i && s.party !== 'Vacant';
        const isKeyboardDragSource = keyboardDragIndex === i;
        const isKeyboardDropTarget =
          keyboardDropIndex === i && isKeyboardDragging;
        const canDrag = s.party !== 'Vacant';
        const seat = layout.seats[i];

        return (
          <div
            key={`${s.party}-${i}`}
            tabIndex={s.party === 'Vacant' ? -1 : 0}
            role="button"
            aria-roledescription={canDrag ? 'draggable seat' : 'seat'}
            aria-label={`${s.party} ${s.type} seat`}
            aria-grabbed={
              canDrag ? isKeyboardDragging && isKeyboardDragSource : undefined
            }
            aria-dropeffect={
              canDrag && isKeyboardDragging && !isKeyboardDragSource
                ? 'move'
                : undefined
            }
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
                if (
                  e.key === 'ArrowUp' ||
                  e.key === 'ArrowDown' ||
                  e.key === 'ArrowLeft' ||
                  e.key === 'ArrowRight'
                ) {
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
              'absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-100 focus:outline-none focus:ring-2 focus:ring-ring/60 focus:z-10',
              (isDragging || isKeyboardDragSource) &&
                'opacity-50 ring-2 ring-foreground/60',
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
              left: x(seat.x),
              top: y(seat.y),
              width: x(seat.size),
              backgroundColor: s.color,
              opacity: s.opacity,
            }}
          />
        );
      })}

      {/* The majority divider: a radial line at the apex, sitting in the gap
          between the two middle columns rather than through a seat. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-10"
        style={{
          left: x(layout.marker.x),
          top: y(layout.marker.y),
          width: 1,
          height: y(layout.marker.length),
          transformOrigin: '50% 0%',
          transform: `rotate(${layout.marker.angle}rad)`,
        }}
      >
        <div className="absolute inset-0 bg-brand" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-10"
        style={{
          left: x(layout.marker.labelX),
          top: `calc(${y(layout.marker.labelY)} - 8px)`,
        }}
      >
        <div className="bg-brand text-background font-label text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 whitespace-nowrap -translate-x-1/2 -translate-y-full">
          {majority} seats required to govern
        </div>
      </div>
    </div>
  );
}
