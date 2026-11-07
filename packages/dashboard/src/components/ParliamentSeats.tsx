import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
} from '@floating-ui/react';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { usePartyOrder } from '../hooks/usePartyOrder.js';
import { buildSeats, winningCoalition } from '../lib/parliament.js';
import { WaitingState } from './WaitingState.js';
import BottomSheet from './BottomSheet.js';
import { ParliamentSeatGrid } from './ParliamentSeatGrid.js';
import { ParliamentTable } from './ParliamentTable.js';
import { SeatDetailContent } from './SeatDetailContent.js';
import { type DragEndEvent } from '@dnd-kit/dom';
import type { SeatChance } from '@election-night/core/seat-probability';
import { isSortable } from '@dnd-kit/react/sortable';
import type {
  ElectorateResult,
  PartyListResult,
  PartyVoteResult,
} from '@election-night/core/types';

const ROWS = 3;

/** A circular arrow: the seating order goes back to the default. */
function ResetOrderIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export default function ParliamentSeats({
  partyVote,
  electorateResults,
  partyLists,
  chances,
}: {
  partyVote: PartyVoteResult[];
  electorateResults: ElectorateResult[];
  partyLists: PartyListResult[];
  chances?: Map<string, SeatChance>;
}) {
  const { order, setOrder, resetOrder, isDefault } = usePartyOrder(partyVote);
  const [draggingParty, setDraggingParty] = useState<string | null>(null);
  const [dropTargetParty, setDropTargetParty] = useState<string | null>(null);
  const [hoveredParty, setHoveredParty] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [showAllParties, setShowAllParties] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isMobile = useMediaQuery('(max-width: 767px)');

  // The popover is portaled to the body and positioned `fixed`, so it measures
  // against the viewport both when it is placed and when it is painted. That
  // matters here: the chamber's card keeps `animate-fade-in-up`'s transform
  // (fill mode `forwards`), and a transformed ancestor is the containing block
  // for its descendants, which is what parked the popover in the card's corner.
  // `transform: false` is the second half of the same fix — the popover's own
  // fade animates `transform`, and an animated declaration outranks an inline
  // one, so Floating UI's offset transform was being replaced by `translateY(0)`.
  const { refs, floatingStyles, isPositioned } = useFloating({
    open: selectedSeat !== null,
    placement: 'right-start',
    strategy: 'fixed',
    transform: false,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const setFloatingRef = useCallback((node: HTMLDivElement | null) => {
    popoverRef.current = node;
    refs.setFloating(node);
  }, []);

  useEffect(() => {
    if (selectedSeat === null || isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // The seat that is already open is the toggle: let its own click close
      // it rather than closing here and then reopening it.
      const referenceEl = refs.reference.current;
      if (referenceEl instanceof HTMLElement && referenceEl.contains(target)) {
        return;
      }
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setSelectedSeat(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedSeat, isMobile, refs.reference]);

  const totalSeats = useMemo(
    () => partyVote.reduce((s, p) => s + p.seats, 0),
    [partyVote]
  );

  const majority = useMemo(() => Math.floor(totalSeats / 2) + 1, [totalSeats]);

  const seats = useMemo(
    () =>
      buildSeats(
        order,
        partyVote,
        electorateResults,
        partyLists,
        totalSeats,
        chances
      ),
    [order, partyVote, electorateResults, partyLists, totalSeats, chances]
  );

  const totalPartyVotes = useMemo(
    () => partyVote.reduce((s, p) => s + p.votes, 0),
    [partyVote]
  );

  const coalitionInfo = useMemo(
    () => winningCoalition(order, partyVote, majority),
    [order, partyVote, majority]
  );

  const handleReorder = (dragged: string, target: string) => {
    if (dragged === target) return;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragged);
      const to = next.indexOf(target);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
    setDraggingParty(null);
    setDropTargetParty(null);
  };

  function handleTableDragEnd(event: DragEndEvent) {
    if ('canceled' in event && event.canceled) return;
    const source = event.operation.source;
    if (isSortable(source)) {
      const { initialIndex, index } = source;
      if (initialIndex != null && index != null && initialIndex !== index) {
        setOrder((prev) => {
          const next = [...prev];
          const [removed] = next.splice(initialIndex, 1);
          next.splice(index, 0, removed);
          return next;
        });
      }
    }
  }

  const empty = partyVote.filter((p) => p.seats > 0).length === 0;

  if (empty) {
    return <WaitingState variant="compact" context="parliament" />;
  }

  const selectedSeatInfo = selectedSeat !== null ? seats[selectedSeat] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base sm:text-lg font-bold tracking-tight">
          Parliament
        </h2>
        {!isDefault && (
          <button
            onClick={resetOrder}
            className="flex h-8 items-center gap-1.5 px-2 font-label text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            type="button"
            aria-label="Reset coalitions"
            title="Reset coalitions"
          >
            <ResetOrderIcon />
            <span className="hidden lg:inline">Reset coalitions</span>
          </button>
        )}
      </div>

      <div className="mt-2">
        <ParliamentSeatGrid
          seats={seats}
          majority={majority}
          draggingParty={draggingParty}
          dropTargetParty={dropTargetParty}
          hoveredParty={hoveredParty}
          selectedSeat={selectedSeat}
          onDragStart={setDraggingParty}
          onDragEnter={setDropTargetParty}
          onDragEnd={() => {
            setDraggingParty(null);
            setDropTargetParty(null);
          }}
          onDrop={handleReorder}
          onHover={setHoveredParty}
          onSelect={(index, element) => {
            if (selectedSeat === index) {
              setSelectedSeat(null);
            } else {
              refs.setReference(element);
              setSelectedSeat(index);
            }
          }}
        />
      </div>

      {selectedSeatInfo &&
        selectedSeat !== null &&
        !isMobile &&
        createPortal(
          <div
            ref={setFloatingRef}
            role="dialog"
            aria-label={`${selectedSeatInfo.party} ${selectedSeatInfo.type} seat`}
            style={{
              ...floatingStyles,
              zIndex: 50,
              // The first paint happens before Floating UI has measured, and at
              // `left: 0` that is the corner of the window.
              visibility: isPositioned ? 'visible' : 'hidden',
            }}
            className="bg-popover border border-border p-3 w-60 animate-fade-in-up text-sm pointer-events-auto"
          >
            <SeatDetailContent
              info={selectedSeatInfo}
              onClose={() => setSelectedSeat(null)}
            />
          </div>,
          document.body
        )}

      <BottomSheet
        open={selectedSeatInfo !== null && isMobile}
        onClose={() => setSelectedSeat(null)}
        title={
          selectedSeatInfo ? `${selectedSeatInfo.party} seat` : 'Seat details'
        }
      >
        {selectedSeatInfo && (
          <SeatDetailContent
            info={selectedSeatInfo}
            onClose={() => setSelectedSeat(null)}
          />
        )}
      </BottomSheet>

      <ParliamentTable
        order={order}
        partyVote={partyVote}
        totalPartyVotes={totalPartyVotes}
        coalitionInfo={coalitionInfo}
        hoveredParty={hoveredParty}
        onHoveredPartyChange={setHoveredParty}
        showAllParties={showAllParties}
        onToggleShowAll={() => setShowAllParties((v) => !v)}
        onDragEnd={handleTableDragEnd}
      />
    </div>
  );
}

export { ROWS };
