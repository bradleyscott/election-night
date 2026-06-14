import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { cn } from '../lib/utils.js';
import { partyColors } from '../lib/constants.js';
import { WaitingState } from '../components/WaitingState.js';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';

const MAJOR_PARTY_ORDER = [
  'National Party',
  'Labour Party',
  'Green Party',
  'ACT New Zealand',
  'New Zealand First Party',
] as const;

const MAJOR_PARTIES = new Set<string>(MAJOR_PARTY_ORDER);

type PartyListEntry = PartyList & WithAdjustedRank;

function buildElectorateLookup(
  electorateResults: { electorateName: string; leaders: { leadingCandidate: string } }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of electorateResults) {
    map.set(r.leaders.leadingCandidate, r.electorateName);
  }
  return map;
}

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
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-1">Party List Rankings</h1>
        <div className="h-1 w-16 bg-gradient-brand rounded-full mb-2" />
        <WaitingState context="parties" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Party List Rankings</h1>
        <div className="h-1 w-16 bg-gradient-brand rounded-full mt-1.5" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {majorParties.map((party) => (
          <button
            key={party}
            onClick={() => setSelectedParty(selectedParty === party ? '' : party)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase transition-colors',
              party === selectedParty || (!selectedParty && party === majorParties[0])
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 ring-1 ring-black/10 shrink-0"
              style={{ backgroundColor: partyColors[party] || '#666' }}
            />
            {party}
          </button>
        ))}

        {otherParties.length > 0 && (
          <select
            value={selectedParty && !MAJOR_PARTIES.has(selectedParty) ? selectedParty : ''}
            onChange={(e) => setSelectedParty(e.target.value)}
            className="rounded-full bg-muted px-3 py-1 text-xs font-bold tracking-wide uppercase text-muted-foreground transition-colors hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-brand"
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
              'rounded-xl border bg-card overflow-hidden shadow-sm',
              'opacity-0 animate-fade-in-up'
            )}
            style={{ animationDelay: `${pIdx * 0.1}s` }}
          >
            <div className="px-3 sm:px-4 py-2 sm:py-3 border-b bg-muted/30 font-extrabold text-sm sm:text-base sticky top-0 bg-background/95 backdrop-blur tracking-tight flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm ring-1 ring-black/10 shrink-0"
                style={{ backgroundColor: partyColors[party] || '#666' }}
              />
              {party}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 sm:py-3 px-3 w-14 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">List</th>
                    <th className="text-left py-2 sm:py-3 px-3 w-14 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Rank</th>
                    <th className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">Candidate</th>
                    <th className="text-right py-2 sm:py-3 px-3 w-24 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">From Cut</th>
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
                                  <div className="w-full border-t-2 border-red-500" />
                                </div>
                                <div className="relative flex justify-center">
                                  <span className="bg-card px-3 text-[10px] font-extrabold tracking-widest uppercase text-red-500">
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
                            isElected ? 'bg-green-50 dark:bg-green-950/20' : '',
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
                                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase text-muted-foreground hover:bg-muted/80 transition-colors"
                                >
                                  {electorate}
                                </Link>
                              )}
                            </span>
                          </td>
                          <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                            {electorate ? null : isElected ? (
                              <span className="text-green-600 dark:text-green-400">
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
