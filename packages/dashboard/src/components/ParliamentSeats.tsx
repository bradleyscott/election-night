import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { WaitingState } from './WaitingState.js';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable, isSortable } from '@dnd-kit/react/sortable';
import { PointerSensor, PointerActivationConstraints } from '@dnd-kit/dom';
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
} from '@floating-ui/react';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import BottomSheet from './BottomSheet.js';
import type {
  VotingResults,
  WithSeats,
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  PartyList,
  WithAdjustedRank,
  PredictionStatus,
} from '@election-night/core/types';

type PartyEntry = VotingResults & WithSeats;
type ElectorateEntry = ElectorateResults & WithLeaders & WithMarginOfError;
type PartyListEntry = PartyList & WithAdjustedRank;

const ROWS = 3;

function defaultOrder(partyVote: PartyEntry[]): string[] {
  const sorted = [...partyVote]
    .filter((p) => p.seats > 0)
    .sort((a, b) => b.seats - a.seats);

  if (sorted.length <= 1) {
    return sorted.map((p) => p.candidate);
  }

  const biggest = sorted[0].candidate;
  const secondBiggest = sorted[1].candidate;
  const rest = sorted.slice(2).map((p) => p.candidate);
  return [biggest, ...rest, secondBiggest];
}

function getOpacity(result: ElectorateEntry): number {
  const ratio = result.leaders.marginPercent / result.marginOfError;
  if (ratio >= 2) return 0.8;
  if (ratio <= 1) return 0.2;
  return 0.2 + (ratio - 1) * 0.6;
}

function getListOpacity(distanceFromCut: number): number {
  if (distanceFromCut >= 10) return 0.8;
  if (distanceFromCut <= 0) return 0.2;
  return 0.2 + (distanceFromCut / 10) * 0.6;
}

type SeatInfo = {
  party: string;
  color: string;
  opacity: number;
  type: 'electorate' | 'list';
  name: string;
  candidate?: string;
  margin?: number;
  marginPercent?: number;
  marginOfError?: number;
  predictionStatus?: PredictionStatus;
  listRank?: number;
  adjustedRank?: number;
  distanceFromCut?: number;
};

function buildSeats(
  order: string[],
  partyVote: PartyEntry[],
  electorates: ElectorateEntry[],
  partyLists: PartyListEntry[],
  totalSeats: number
): SeatInfo[] {
  const out: SeatInfo[] = [];

  const partyElectorates = new Map<string, ElectorateEntry[]>();
  for (const e of electorates) {
    const p = e.leaders.leadingCandidateParty;
    if (!p) continue;
    const arr = partyElectorates.get(p) ?? [];
    arr.push(e);
    partyElectorates.set(p, arr);
  }

  const electorateWinner = new Map<string, string>();
  for (const e of electorates) {
    electorateWinner.set(e.leaders.leadingCandidate, e.electorateName);
  }

  const listCandidatesByParty = new Map<string, PartyListEntry[]>();
  for (const entry of partyLists) {
    const arr = listCandidatesByParty.get(entry.party) ?? [];
    arr.push(entry);
    listCandidatesByParty.set(entry.party, arr);
  }

  const midIndex = order.length / 2;

  for (let idx = 0; idx < order.length; idx++) {
    const name = order[idx];
    const p = partyVote.find((x) => x.candidate === name);
    if (!p || p.seats <= 0) continue;
    const color = partyColors[name] || '#666';
    const elecSeats = p.electorateSeats;
    const listSeats = p.listSeats;

    const isRightSide = idx >= midIndex;

    const wins = (partyElectorates.get(name) ?? [])
      .slice()
      .sort((a, b) =>
        isRightSide
          ? a.leaders.marginPercent - b.leaders.marginPercent
          : b.leaders.marginPercent - a.leaders.marginPercent
      );

    const partySeats: SeatInfo[] = [];

    for (let i = 0; i < elecSeats && i < wins.length; i++) {
      const e = wins[i];
      partySeats.push({
        party: name,
        color,
        opacity: getOpacity(e),
        type: 'electorate',
        name: e.electorateName,
        candidate: e.leaders.leadingCandidate,
        margin: e.leaders.margin,
        marginPercent: e.leaders.marginPercent,
        marginOfError: e.marginOfError,
        predictionStatus: e.leaders.predictionStatus,
      });
    }

    for (let i = wins.length; i < elecSeats; i++) {
      partySeats.push({
        party: name,
        color,
        opacity: 0.5,
        type: 'electorate',
        name: `Electorate ${i + 1}`,
      });
    }

    const partyListCandidates = (listCandidatesByParty.get(name) ?? [])
      .filter((c) => !electorateWinner.has(c.candidate))
      .sort((a, b) => a.adjustedRank - b.adjustedRank);

    for (let i = 0; i < listSeats; i++) {
      const c = partyListCandidates[i];
      partySeats.push({
        party: name,
        color,
        opacity: c?.distanceFromCut !== undefined ? getListOpacity(c.distanceFromCut) : 1,
        type: 'list',
        name: `List seat ${i + 1}`,
        candidate: c?.candidate,
        listRank: c?.listRank,
        adjustedRank: c?.adjustedRank,
        distanceFromCut: c?.distanceFromCut,
      });
    }

    if (isRightSide) {
      partySeats.sort((a, b) => a.opacity - b.opacity);
    } else {
      partySeats.sort((a, b) => b.opacity - a.opacity);
    }

    out.push(...partySeats);
  }

  while (out.length < totalSeats) {
    out.push({ party: 'Vacant', color: '#444', opacity: 0.3, type: 'list', name: 'Vacant' });
  }

  return out;
}

const touchSensor = PointerSensor.configure({
  activationConstraints(event) {
    if (event.pointerType === 'touch') {
      return [
        new PointerActivationConstraints.Delay({ value: 200, tolerance: 10 }),
      ];
    }
    return [new PointerActivationConstraints.Distance({ value: 5 })];
  },
});

function SortableRow({
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
        isHovered && !isDragging ? 'bg-white/5' : 'hover:bg-muted/30',
        isDragging && 'opacity-50',
        isDropTarget && !isDragging && 'border-t-2 border-yellow-400'
      )}
    >
      <td className="py-2 sm:py-3 pr-4 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm flex-shrink-0 ring-1 ring-black/10"
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
          {(party.votes / totalPartyVotes * 100).toFixed(1)}%
        </span>
      </td>
      <td className="text-right px-2 tabular-nums font-semibold hidden sm:table-cell">
        {party.electorateSeats}
      </td>
      <td className="text-right px-2 tabular-nums font-semibold hidden sm:table-cell">
        {party.listSeats}
      </td>
      <td className="text-right pl-2 font-extrabold tabular-nums">{party.seats}</td>
    </tr>
  );
}

function SeatDetailContent({
  info,
  onClose,
}: {
  info: SeatInfo;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{
              backgroundColor: info.color,
              opacity: info.opacity,
            }}
          />
          <span className="font-bold truncate text-sm">
            {info.party}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs leading-none p-0.5"
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          {info.type === 'list' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-orange-500/20 text-orange-400">
              List
            </span>
          )}
          {info.type === 'electorate' && (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-bold',
                info.predictionStatus === 'projected' && 'bg-green-500/20 text-green-400',
                info.predictionStatus === 'likely' && 'bg-lime-500/20 text-lime-400',
                info.predictionStatus === 'leaning' && 'bg-orange-500/20 text-orange-400',
                info.predictionStatus === 'too-close' && 'bg-amber-500/20 text-amber-400',
                !info.predictionStatus && 'bg-amber-500/20 text-amber-400'
              )}
            >
              {(info.predictionStatus === 'projected' || info.predictionStatus === 'likely') && 'Likely winner'}
              {info.predictionStatus === 'leaning' && 'Leaning'}
              {info.predictionStatus === 'too-close' && 'Too close to call'}
              {!info.predictionStatus && 'Too close to call'}
            </span>
          )}
        </div>

        {info.type === 'electorate' &&
          info.name && (
            <div>
              <div className="text-muted-foreground">Electorate</div>
              <Link
                to={`/electorates/${encodeURIComponent(info.name)}`}
                className="font-semibold text-primary hover:underline"
                onClick={onClose}
              >
                {info.name}
              </Link>
            </div>
          )}

        {info.type === 'electorate' &&
          info.candidate && (
            <div>
              <div className="text-muted-foreground">Candidate</div>
              <div className="font-semibold">
                {info.candidate}
              </div>
            </div>
          )}

        {info.type === 'electorate' &&
          info.margin !== undefined && (
            <div>
              <div className="text-muted-foreground">Margin</div>
              <div className="font-semibold tabular-nums">
                {info.margin.toLocaleString()} votes
              </div>
            </div>
          )}

        {info.type === 'electorate' &&
          info.marginPercent !== undefined && (
            <div>
              <div className="text-muted-foreground">Lead</div>
              <div className="font-semibold tabular-nums">
                {(info.marginPercent * 100).toFixed(1)}%
                {info.marginOfError !== undefined && (
                  <span className="text-muted-foreground font-normal">
                    {' '}±{(info.marginOfError * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}

        {info.type === 'list' && info.candidate && (
          <>
            <div>
              <div className="text-muted-foreground">Candidate</div>
              <div className="font-semibold">
                {info.candidate}
              </div>
            </div>
            {info.listRank !== undefined && (
              <div>
                <div className="text-muted-foreground">List Rank</div>
                <div className="font-semibold tabular-nums">
                  #{info.listRank}
                </div>
              </div>
            )}
            {info.adjustedRank !== undefined && (
              <div>
                <div className="text-muted-foreground">Adjusted Rank</div>
                <div className="font-semibold tabular-nums">
                  #{info.adjustedRank}
                </div>
              </div>
            )}
            {info.distanceFromCut !== undefined && (
              <div>
                <div className="text-muted-foreground">From Cut</div>
                <div className={cn(
                  'font-semibold tabular-nums',
                  info.distanceFromCut >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-muted-foreground'
                )}>
                  {info.distanceFromCut >= 0 ? '+' : ''}
                  {Math.round(info.distanceFromCut)}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </>
  );
}

export default function ParliamentSeats({
  partyVote,
  electorateResults,
  partyLists,
}: {
  partyVote: PartyEntry[];
  electorateResults: ElectorateEntry[];
  partyLists: PartyListEntry[];
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [draggingParty, setDraggingParty] = useState<string | null>(null);
  const [dropTargetParty, setDropTargetParty] = useState<string | null>(null);
  const [hoveredParty, setHoveredParty] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [showAllParties, setShowAllParties] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
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
    const saved = localStorage.getItem('parliament-party-order');
    let base: string[] | null = null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[];
        const active = partyVote
          .filter((p) => p.seats > 0)
          .map((p) => p.candidate);
        const valid = parsed.filter((p) => active.includes(p));
        if (valid.length === active.length) {
          base = valid;
        }
      } catch {
        /* ignore */
      }
    }

    setOrder(base ?? defaultOrder(partyVote));
  }, [partyVote]);

  useEffect(() => {
    if (order.length > 0) {
      localStorage.setItem('parliament-party-order', JSON.stringify(order));
    }
  }, [order]);

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

  function handleTableDragEnd(event: { canceled?: boolean; operation: { source: unknown } }) {
    if ('canceled' in event && event.canceled) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = event.operation.source as any;
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

  const resetOrder = () => {
    setOrder(defaultOrder(partyVote));
  };

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
              setDropTargetParty(null);
            }
          }}
        >
          <div
            ref={gridRef}
            className="grid gap-px sm:gap-0.5 min-w-[480px] select-none"
            style={{
              gridAutoFlow: 'column',
              gridTemplateRows: `repeat(${ROWS}, auto)`,
              gridAutoColumns: '1fr',
            }}
          >
            {seats.map((s, i) => {
              const isDragging = draggingParty === s.party;
              const isDropTarget =
                dropTargetParty === s.party && !isDragging;
              const isHovered =
                hoveredParty === s.party && !draggingParty;
              const isSelected = selectedSeat === i && s.party !== 'Vacant';

              return (
                <div
                  key={`${s.party}-${i}`}
                  draggable
                  onDragStart={() => setDraggingParty(s.party)}
                  onDragEnter={() => setDropTargetParty(s.party)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingParty && draggingParty !== s.party) {
                      handleReorder(draggingParty, s.party);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggingParty(null);
                    setDropTargetParty(null);
                  }}
                  onMouseEnter={() => setHoveredParty(s.party)}
                  onMouseLeave={() => setHoveredParty(null)}
                  onClick={(e) => {
                    if (s.party !== 'Vacant') {
                      if (selectedSeat === i) {
                        setSelectedSeat(null);
                      } else {
                        refs.setReference(e.currentTarget);
                        setSelectedSeat(i);
                      }
                    }
                  }}
                  className={cn(
                    'aspect-square rounded-[2px] transition-all duration-100',
                    isDragging && 'opacity-50 ring-2 ring-white/60',
                    isDropTarget && 'ring-2 ring-yellow-400',
                    isHovered && 'ring-2 ring-white/50 z-10',
                    isSelected && 'ring-2 ring-white z-20',
                    !isDragging &&
                      !isDropTarget &&
                      !isHovered &&
                      !isSelected &&
                      'ring-1 ring-white/10',
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

      <DragDropProvider
        onDragEnd={handleTableDragEnd}
        sensors={[touchSensor]}
      >
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm sm:text-base">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 sm:py-3 pr-4 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Party</th>
                <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Party votes</th>
                <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs hidden sm:table-cell">Electorate seats</th>
                <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs hidden sm:table-cell">List seats</th>
                <th className="text-right pl-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Total seats</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const partiesWithSeats = order
                  .map((name) => partyVote.find((p) => p.candidate === name))
                  .filter((p): p is PartyEntry => !!p && p.seats > 0);

                const displayParties = showAllParties
                  ? [
                      ...partiesWithSeats,
                      ...partyVote
                        .filter((p) => p.seats === 0)
                        .sort((a, b) => b.votes - a.votes),
                    ]
                  : partiesWithSeats;

                return displayParties.map((party) => {
                  if (party.seats === 0) {
                    return (
                      <tr
                        key={party.candidate}
                        className="border-b last:border-0 opacity-60"
                      >
                        <td className="py-2 sm:py-3 pr-4 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm flex-shrink-0 ring-1 ring-black/10"
                              style={{
                                backgroundColor:
                                  partyColors[party.candidate] || '#666',
                              }}
                            />
                            <span className="font-bold truncate min-w-0">
                              {party.candidate}
                            </span>
                          </div>
                        </td>
                        <td className="text-right px-2 tabular-nums font-semibold whitespace-nowrap">
                          <span className="hidden sm:inline">
                            {party.votes.toLocaleString()}{' '}
                          </span>
                          <span className="text-muted-foreground text-xs font-normal sm:ml-1.5">
                            {(
                              (party.votes / totalPartyVotes) *
                              100
                            ).toFixed(1)}
                            %
                          </span>
                        </td>
                        <td className="text-right px-2 tabular-nums font-semibold hidden sm:table-cell">
                          0
                        </td>
                        <td className="text-right px-2 tabular-nums font-semibold hidden sm:table-cell">
                          0
                        </td>
                        <td className="text-right pl-2 font-extrabold tabular-nums">
                          0
                        </td>
                      </tr>
                    );
                  }

                  const sortableIndex = partiesWithSeats.indexOf(party);
                  return (
                    <SortableRow
                      key={party.candidate}
                      party={party}
                      totalPartyVotes={totalPartyVotes}
                      index={sortableIndex}
                      hoveredParty={hoveredParty}
                      onHoveredPartyChange={(p) => setHoveredParty(p)}
                    />
                  );
                });
              })()}
            </tbody>
            {coalitionInfo.parties.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-muted-foreground/20 bg-muted/20">
                  <td
                    colSpan={5}
                    className="py-3 text-sm"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground font-semibold uppercase tracking-wide text-xs">
                        Coalition
                      </span>
                      <div className="flex items-center gap-1">
                        {coalitionInfo.parties.map((p, i) => (
                          <span key={p.candidate} className="inline-flex items-center gap-1">
                            {i > 0 && <span className="text-muted-foreground/50 mx-0.5">+</span>}
                            <span
                              className="w-2.5 h-2.5 rounded-sm ring-1 ring-black/10 flex-shrink-0"
                              style={{ backgroundColor: partyColors[p.candidate] || '#666' }}
                            />
                            <span className="font-bold whitespace-nowrap">{p.candidate}</span>
                          </span>
                        ))}
                        <span className="text-muted-foreground/50 mx-1">=</span>
                        <span className="font-extrabold tabular-nums">{coalitionInfo.cumulative}</span>
                        <span className="text-muted-foreground mr-1">seats</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="flex justify-center">
          <button
            onClick={() => setShowAllParties(!showAllParties)}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold tracking-wide uppercase transition-colors bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            type="button"
          >
            <span
              className={cn(
                'inline-block transition-transform duration-200 text-[10px]',
                showAllParties && 'rotate-180'
              )}
            >
              ▼
            </span>
            {showAllParties
              ? 'Show only parties with seats'
              : 'Show all parties with votes'}
          </button>
        </div>
      </DragDropProvider>

    </div>
  );
}