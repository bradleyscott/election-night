import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
} from '@floating-ui/react';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { usePartyOrder } from '../hooks/usePartyOrder.js';
import { buildSeats } from '../lib/parliament.js';
import type { PartyEntry, ElectorateEntry, PartyListEntry } from '../lib/parliament.js';
import { WaitingState } from './WaitingState.js';
import BottomSheet from './BottomSheet.js';
import { ParliamentSeatGrid } from './ParliamentSeatGrid.js';
import { ParliamentTable } from './ParliamentTable.js';
import { SeatDetailContent } from './SeatDetailContent.js';
import { type DragEndEvent } from '@dnd-kit/dom';
import { isSortable } from '@dnd-kit/react/sortable';

const ROWS = 3;

export default function ParliamentSeats({
  partyVote,
  electorateResults,
  partyLists,
}: {
  partyVote: PartyEntry[];
  electorateResults: ElectorateEntry[];
  partyLists: PartyListEntry[];
}) {
  const { order, setOrder, resetOrder } = usePartyOrder(partyVote);
  const [draggingParty, setDraggingParty] = useState<string | null>(null);
  const [dropTargetParty, setDropTargetParty] = useState<string | null>(null);
  const [hoveredParty, setHoveredParty] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [showAllParties, setShowAllParties] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isMobile = useMediaQuery('(max-width: 767px)');

  const { refs, floatingStyles } = useFloating({
    open: selectedSeat !== null,
    placement: 'right-start',
    strategy: 'fixed',
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
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectedSeat(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedSeat, isMobile]);

  const totalSeats = useMemo(
    () => partyVote.reduce((s, p) => s + p.seats, 0),
    [partyVote]
  );

  const majority = useMemo(() => Math.floor(totalSeats / 2) + 1, [totalSeats]);

  const seats = useMemo(
    () => buildSeats(order, partyVote, electorateResults, partyLists, totalSeats),
    [order, partyVote, electorateResults, partyLists, totalSeats]
  );

  const totalPartyVotes = useMemo(
    () => partyVote.reduce((s, p) => s + p.votes, 0),
    [partyVote]
  );

  const coalitionInfo = useMemo(() => {
    let cumulative = 0;
    const parties: PartyEntry[] = [];
    for (const name of order) {
      const party = partyVote.find((p) => p.candidate === name);
      if (!party || party.seats <= 0) continue;
      if (cumulative >= majority) break;
      parties.push(party);
      cumulative += party.seats;
    }
    return { parties, cumulative };
  }, [order, partyVote, majority]);

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-extrabold tracking-tight">
            Parliament
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetOrder}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            type="button"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="relative mt-8 mb-2">
        <ParliamentSeatGrid
          seats={seats}
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

        <div
          className="absolute pointer-events-none inset-y-0 z-10"
          style={{ left: '50%', width: 0 }}
        >
          <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-yellow-400 rounded-full" />
          <div className="absolute inset-y-0 w-3 -translate-x-1/2 bg-yellow-400/20" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap">
            <div className="bg-yellow-400 text-black text-xs font-extrabold px-2 py-0.5 rounded shadow-lg shadow-yellow-400/30">
              {majority} seats required to govern
            </div>
          </div>
        </div>
      </div>

      {selectedSeatInfo && selectedSeat !== null && !isMobile && (
        <div
          ref={setFloatingRef}
          style={{ ...floatingStyles, zIndex: 50 }}
          className="bg-card border rounded-lg shadow-xl p-3 w-56 animate-fade-in-up text-sm pointer-events-auto"
        >
          <SeatDetailContent
            info={selectedSeatInfo}
            onClose={() => setSelectedSeat(null)}
          />
        </div>
      )}

      <BottomSheet
        open={selectedSeatInfo !== null && isMobile}
        onClose={() => setSelectedSeat(null)}
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
