import { useMemo } from 'react';
import { partyColor, buildElectorateLookup } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from './WaitingState.js';
import type {
  ElectorateResult,
  PartyListResult,
} from '@election-night/core/types';
import { PartyDot } from './PartyDot.js';
import { Th } from './Table.js';

export function ListCutLinesView({
  partyLists,
  electorateResults,
  selectedParty,
  majorParties,
  otherParties,
  onPartyClick,
}: {
  partyLists: PartyListResult[];
  electorateResults: ElectorateResult[];
  selectedParty: string;
  majorParties: string[];
  otherParties: string[];
  onPartyClick: (party: string) => void;
}) {
  const electorateForCandidate = useMemo(
    () => buildElectorateLookup(electorateResults),
    [electorateResults]
  );

  const activeParty = selectedParty;

  const members = useMemo(() => {
    if (!activeParty) return { above: [], below: [] };
    const party = partyLists.filter(
      (l) => l.party === activeParty && !electorateForCandidate.has(l.candidate)
    );
    const sorted = [...party].sort((a, b) => a.adjustedRank - b.adjustedRank);

    const aboveCut = sorted.filter((m) => m.distanceFromCut >= 0);
    const belowCut = sorted.filter((m) => m.distanceFromCut < 0);

    const above = aboveCut.slice(-3);
    const below = belowCut.slice(0, 3);

    return { above, below };
  }, [partyLists, activeParty, electorateForCandidate]);

  const cutIdx = members.above.length;

  const allMembers = useMemo(
    () => [...members.above, ...members.below],
    [members]
  );

  if (!partyLists.length) {
    return <WaitingState variant="compact" context="parties" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {majorParties.map((party) => (
          <button
            key={party}
            onClick={() => onPartyClick(party)}
            className={cn(
              'chip-print transition-colors',
              selectedParty === party
                ? 'bg-foreground text-background border-foreground'
                : 'hover:bg-muted/40'
            )}
          >
            <PartyDot color={partyColor(party)} className="mr-1.5" />
            {party}
          </button>
        ))}

        {otherParties.length > 0 && (
          <select
            value={!majorParties.includes(activeParty) ? activeParty : ''}
            onChange={(e) => {
              if (e.target.value) {
                onPartyClick(e.target.value);
              }
            }}
            className="chip-print bg-background hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">More…</option>
            {otherParties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      {activeParty && (
        <div className="border border-border overflow-hidden">
          <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border font-display font-bold text-sm sm:text-base tracking-tight flex items-center gap-2">
            <PartyDot color={partyColor(activeParty)} size="md" />
            {activeParty}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th className="w-14">List</Th>
                  <Th className="w-14">Rank</Th>
                  <Th>Candidate</Th>
                  <Th align="right" className="px-3 w-24">
                    From Cut
                  </Th>
                </tr>
              </thead>
              <tbody>
                {allMembers.flatMap((member, mIdx) => {
                  const isElected = member.distanceFromCut >= 0;
                  const rows = [];

                  if (mIdx === cutIdx && members.below.length > 0) {
                    rows.push(
                      <tr key="cut-line">
                        <td colSpan={4} className="px-0 py-0">
                          <div className="relative flex items-center py-1">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t-2 border-brand" />
                            </div>
                            <div className="relative flex justify-center">
                              <span className="bg-background px-3 font-label text-[10px] font-bold tracking-widest uppercase text-brand">
                                Cut
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  rows.push(
                    <tr
                      key={member.candidate}
                      className={cn(
                        'border-b last:border-0 transition-colors hover:bg-muted/20',
                        isElected ? 'bg-green-700/5 dark:bg-green-950/20' : '',
                        'opacity-0 animate-fade-in-up'
                      )}
                      style={{ animationDelay: `${mIdx * 0.04}s` }}
                    >
                      <td className="py-2 sm:py-3 px-3 text-muted-foreground tabular-nums font-semibold">
                        {member.listRank}
                      </td>
                      <td className="py-2 sm:py-3 px-3 tabular-nums font-bold">
                        {member.adjustedRank}
                      </td>
                      <td className="py-2 sm:py-3 px-3 font-semibold">
                        {member.candidate}
                      </td>
                      <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                        {isElected ? (
                          <span className="text-green-700 dark:text-green-400">
                            +{Math.round(member.distanceFromCut)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {Math.round(member.distanceFromCut)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );

                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
