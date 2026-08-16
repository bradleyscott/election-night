import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { cn } from '../lib/utils.js';
import {
  partyColors,
  MAJOR_PARTY_ORDER,
  MAJOR_PARTIES,
  buildElectorateLookup,
} from '../lib/constants.js';
import { WaitingState } from '../components/WaitingState.js';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';

type PartyListEntry = PartyList & WithAdjustedRank;

export default function Parties() {
  const { results } = useResults();
  const [searchParams] = useSearchParams();
  const [selectedParty, setSelectedParty] = useState<string>(searchParams.get('party') ?? '');
  const [showElectorateLeaders, setShowElectorateLeaders] = useState(false);

  useEffect(() => {
    setSelectedParty(searchParams.get('party') ?? '');
  }, [searchParams]);

  const partyLists = (results?.partyLists ?? []) as PartyListEntry[];

  const electorateForCandidate = useMemo(
    () => (results?.electorateResults ? buildElectorateLookup(results.electorateResults) : new Map<string, string>()),
    [results?.electorateResults]
  );

  const allParties = useMemo(
    () => [...new Set(partyLists.map((l) => l.party))],
    [partyLists]
  );
  const allPartiesSet = useMemo(() => new Set(allParties), [allParties]);
  const majorParties = useMemo(
    () => MAJOR_PARTY_ORDER.filter((p) => allPartiesSet.has(p)),
    [allPartiesSet]
  );
  const otherParties = useMemo(
    () => allParties.filter((p) => !MAJOR_PARTIES.has(p)),
    [allParties]
  );
  const parties = selectedParty
    ? [selectedParty]
    : majorParties.length
      ? [majorParties[0]]
      : allParties;

  if (!partyLists.length) {
    return (
      <div className="animate-fade-in">
        <div className="pagehead">
          <h1>Party List Rankings</h1>
        </div>
        <WaitingState context="parties" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="pagehead">
        <h1>Party List Rankings</h1>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {majorParties.map((party) => (
          <button
            key={party}
            onClick={() => setSelectedParty(selectedParty === party ? '' : party)}
            className={cn(
              'chip-print transition-colors',
              party === selectedParty || (!selectedParty && party === majorParties[0])
                ? 'bg-foreground text-background border-foreground'
                : 'hover:bg-muted/40'
            )}
          >
            <span
              className="inline-block w-2 h-2 ring-1 ring-foreground/20 mr-0.5 shrink-0"
              style={{ backgroundColor: partyColors[party] || '#666' }}
            />
            {party}
          </button>
        ))}

        {otherParties.length > 0 && (
          <select
            value={selectedParty && !MAJOR_PARTIES.has(selectedParty) ? selectedParty : ''}
            onChange={(e) => setSelectedParty(e.target.value)}
            className="chip-print bg-background hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">More…</option>
            {otherParties.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-muted-foreground">
        <input
          type="checkbox"
          checked={showElectorateLeaders}
          onChange={(e) => setShowElectorateLeaders(e.target.checked)}
          className="accent-brand size-4"
        />
        Show electorate leaders
      </label>

      {parties.map((party, pIdx) => {
        const members = partyLists
          .filter((l) => l.party === party && (showElectorateLeaders || !electorateForCandidate.has(l.candidate)))
          .sort((a, b) => {
            const aIsLeader = electorateForCandidate.has(a.candidate);
            const bIsLeader = electorateForCandidate.has(b.candidate);
            if (aIsLeader !== bIsLeader) return aIsLeader ? -1 : 1;
            return a.adjustedRank - b.adjustedRank;
          });

        return (
          <div
            key={party}
            className={cn(
              'border overflow-hidden',
              'opacity-0 animate-fade-in-up'
            )}
            style={{ animationDelay: `${pIdx * 0.1}s` }}
          >
            <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border font-display font-bold text-sm sm:text-base flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 ring-1 ring-foreground/20 shrink-0"
                style={{ backgroundColor: partyColors[party] || '#666' }}
              />
              {party}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 sm:py-3 px-3 w-14 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">List</th>
                    <th className="text-left py-2 sm:py-3 px-3 w-14 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">Rank</th>
                    <th className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">Candidate</th>
                    <th className="text-right py-2 sm:py-3 px-3 w-24 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">From Cut</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let cutIdx = 0;
                    for (let i = members.length - 1; i >= 0; i--) {
                      if (members[i].distanceFromCut >= 0) {
                        cutIdx = i + 1;
                        break;
                      }
                    }
                    return members.flatMap((member, mIdx) => {
                      const electorate = electorateForCandidate.get(member.candidate);
                      const isElected = member.distanceFromCut >= 0 || !!electorate;
                      const rows = [];
                      if (mIdx === cutIdx) {
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
                          style={{ animationDelay: `${pIdx * 0.1 + 0.1 + mIdx * 0.03}s` }}
                        >
                          <td className="py-2 sm:py-3 px-3 text-muted-foreground tabular-nums font-semibold">
                            {member.listRank}
                          </td>
                          <td className="py-2 sm:py-3 px-3 tabular-nums font-bold">
                            {electorate ? null : member.adjustedRank}
                          </td>
                          <td className="py-2 sm:py-3 px-3 font-semibold">
                            <span className="flex flex-wrap items-center gap-1.5">
                              {member.candidate}
                              {electorate && (
                                <Link
                                  to={`/electorates/${encodeURIComponent(electorate)}`}
                                  className="chip-print hover:bg-muted/40 transition-colors"
                                >
                                  {electorate}
                                </Link>
                              )}
                            </span>
                          </td>
                          <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                            {electorate ? null : isElected ? (
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
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
