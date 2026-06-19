import { DragDropProvider } from '@dnd-kit/react';
import {
  PointerSensor,
  PointerActivationConstraints,
  type DragEndEvent,
} from '@dnd-kit/dom';
import { cn } from '../lib/utils.js';
import { partyColors } from '../lib/constants.js';
import { SortableRow } from './SortableRow.js';
import type { PartyEntry } from '../lib/parliament.js';

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

export function ParliamentTable({
  order,
  partyVote,
  totalPartyVotes,
  coalitionInfo,
  hoveredParty,
  onHoveredPartyChange,
  showAllParties,
  onToggleShowAll,
  onDragEnd,
}: {
  order: string[];
  partyVote: PartyEntry[];
  totalPartyVotes: number;
  coalitionInfo: { parties: PartyEntry[]; cumulative: number };
  hoveredParty: string | null;
  onHoveredPartyChange: (party: string | null) => void;
  showAllParties: boolean;
  onToggleShowAll: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
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

  return (
    <DragDropProvider onDragEnd={onDragEnd} sensors={[touchSensor]}>
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm sm:text-base">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 sm:py-3 pr-4 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Party
              </th>
              <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Party votes
              </th>
              <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs hidden sm:table-cell">
                Electorate seats
              </th>
              <th className="text-right px-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs hidden sm:table-cell">
                List seats
              </th>
              <th className="text-right pl-2 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Total seats
              </th>
            </tr>
          </thead>
          <tbody>
            {displayParties.map((party) => {
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
                        {((party.votes / totalPartyVotes) * 100).toFixed(1)}%
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
                  onHoveredPartyChange={onHoveredPartyChange}
                />
              );
            })}
          </tbody>
          {coalitionInfo.parties.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-muted-foreground/20 bg-muted/20">
                <td colSpan={5} className="py-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground font-semibold uppercase tracking-wide text-xs">
                      Coalition
                    </span>
                    <div className="flex items-center gap-1">
                      {coalitionInfo.parties.map((p, i) => (
                        <span
                          key={p.candidate}
                          className="inline-flex items-center gap-1"
                        >
                          {i > 0 && (
                            <span className="text-muted-foreground/50 mx-0.5">
                              +
                            </span>
                          )}
                          <span
                            className="w-2.5 h-2.5 rounded-sm ring-1 ring-black/10 flex-shrink-0"
                            style={{
                              backgroundColor:
                                partyColors[p.candidate] || '#666',
                            }}
                          />
                          <span className="font-bold whitespace-nowrap">
                            {p.candidate}
                          </span>
                        </span>
                      ))}
                      <span className="text-muted-foreground/50 mx-1">=</span>
                      <span className="font-extrabold tabular-nums">
                        {coalitionInfo.cumulative}
                      </span>
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
          onClick={onToggleShowAll}
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
  );
}
