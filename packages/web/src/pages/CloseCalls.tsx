import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  PartyList,
  WithAdjustedRank,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;
type PartyListEntry = PartyList & WithAdjustedRank;

const PAGE_SIZE = 10;

const MAJOR_PARTY_ORDER = [
  'National Party',
  'Labour Party',
  'Green Party',
  'ACT New Zealand',
  'New Zealand First Party',
] as const;

const MAJOR_PARTIES = new Set<string>(MAJOR_PARTY_ORDER);

function buildElectorateLookup(
  electorateResults: { electorateName: string; leaders: { leadingCandidate: string } }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of electorateResults) {
    map.set(r.leaders.leadingCandidate, r.electorateName);
  }
  return map;
}

function Toggle({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg border overflow-hidden text-sm font-bold flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={cn(
            'px-3 py-2 sm:py-1.5 transition-colors min-h-[44px] font-bold',
            value === opt.value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-background text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ElectorateRacesView({
  electorates,
}: {
  electorates: ElectorateResult[];
}) {
  const [page, setPage] = useState(0);

  const sorted = useMemo(
    () =>
      [...electorates].sort((a, b) => a.leaders.marginPercent - b.leaders.marginPercent),
    [electorates]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageResults = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [totalPages, page]);

  if (!sorted.length) {
    return (
      <p className="text-sm text-muted-foreground animate-pulse-soft font-semibold py-4 text-center">
        Waiting for data…
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Electorate
              </th>
              <th className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Leading
              </th>
              <th className="hidden sm:table-cell text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Second
              </th>
              <th className="text-right py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Lead (votes)
              </th>
              <th className="text-right py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Lead %
              </th>
              <th className="text-right py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                MoE
              </th>
            </tr>
          </thead>
          <tbody>
            {pageResults.map((er, i) => {
              const l = er.leaders;
              return (
                <tr
                  key={er.electorateName}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-muted/20',
                    'opacity-0 animate-fade-in-up'
                  )}
                  style={{ animationDelay: `${i * 0.03}s` }}
                >
                  <td className="py-2 sm:py-3 px-3 font-semibold">
                    <Link
                      to={`/electorates/${encodeURIComponent(er.electorateName)}`}
                      className="hover:underline transition-colors"
                    >
                      {er.electorateName}
                    </Link>
                  </td>
                  <td className="py-2 sm:py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                        style={{ backgroundColor: partyColors[l.leadingCandidateParty ?? ''] || '#666' }}
                      />
                      <span className="font-semibold">{l.leadingCandidate}</span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                        style={{ backgroundColor: partyColors[l.secondCandidateParty ?? ''] || '#666' }}
                      />
                      <span className="text-muted-foreground">{l.secondCandidate}</span>
                    </div>
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                    {l.margin.toLocaleString()}
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                    {(l.marginPercent * 100).toFixed(2)}%
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold text-muted-foreground">
                    ±{(er.marginOfError * 100).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className={cn(
              'px-3 py-1 text-sm font-bold rounded-lg transition-colors',
              page === 0
                ? 'text-muted-foreground/40 cursor-default'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={cn(
                'w-8 h-8 text-sm font-bold rounded-lg transition-colors',
                i === page
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page === totalPages - 1}
            className={cn(
              'px-3 py-1 text-sm font-bold rounded-lg transition-colors',
              page === totalPages - 1
                ? 'text-muted-foreground/40 cursor-default'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ListCutLinesView({
  partyLists,
  electorateResults,
  selectedParty,
  majorParties,
  otherParties,
  onPartyClick,
}: {
  partyLists: PartyListEntry[];
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
  }, [partyLists, activeParty]);

  const cutIdx = members.above.length;

  const allMembers = useMemo(
    () => [...members.above, ...members.below],
    [members]
  );

  if (!partyLists.length) {
    return (
      <p className="text-sm text-muted-foreground animate-pulse-soft font-semibold py-4 text-center">
        Waiting for data…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {majorParties.map((party) => (
          <button
            key={party}
            onClick={() => onPartyClick(party)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase transition-colors',
              selectedParty === party
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
            value={!MAJOR_PARTIES.has(activeParty) ? activeParty : ''}
            onChange={(e) => {
              if (e.target.value) {
                onPartyClick(e.target.value);
              }
            }}
            className="rounded-full bg-muted px-3 py-1 text-xs font-bold tracking-wide uppercase text-muted-foreground transition-colors hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">More…</option>
            {otherParties.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>

      {activeParty && (
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
          <div className="px-3 sm:px-4 py-2 sm:py-3 border-b bg-muted/30 font-extrabold text-sm sm:text-base tracking-tight flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm ring-1 ring-black/10 shrink-0"
              style={{ backgroundColor: partyColors[activeParty] || '#666' }}
            />
            {activeParty}
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
                {allMembers.flatMap((member, mIdx) => {
                  const isElected = member.distanceFromCut >= 0;
                  const rows = [];

                  if (mIdx === cutIdx && members.below.length > 0) {
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
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CloseCalls() {
  const { results } = useResults();
  const [view, setView] = useState('electorates');

  const electorates = (results?.electorateResults ?? []) as ElectorateResult[];
  const partyLists = (results?.partyLists ?? []) as PartyListEntry[];

  const allParties = useMemo(
    () => [...new Set(partyLists.map((l) => l.party))],
    [partyLists]
  );
  const allPartiesSet = useMemo(() => new Set(allParties), [allParties]);
  const majorParties: string[] = useMemo(
    () => MAJOR_PARTY_ORDER.filter((p) => allPartiesSet.has(p)),
    [allPartiesSet]
  );
  const otherParties = useMemo(
    () => allParties.filter((p) => !MAJOR_PARTIES.has(p)),
    [allParties]
  );

  const [selectedParty, setSelectedParty] = useState<string>('');
  const [autoRotate, setAutoRotate] = useState(true);
  const [countdown, setCountdown] = useState(5);

  const rotate = useCallback(() => {
    if (!majorParties.length) return;
    setSelectedParty((prev) => {
      const idx = prev ? majorParties.indexOf(prev) : -1;
      return majorParties[(idx + 1) % majorParties.length];
    });
    setCountdown(5);
  }, [majorParties]);

  useEffect(() => {
    if (!!selectedParty || !majorParties.length) return;
    setSelectedParty(majorParties[0]);
  }, [majorParties, selectedParty]);

  useEffect(() => {
    if (view !== 'list' || !autoRotate || !majorParties.length) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          rotate();
          return 5;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [view, autoRotate, majorParties, rotate]);

  const handlePartyClick = (party: string) => {
    if (selectedParty === party) {
      setAutoRotate(true);
    } else {
      setSelectedParty(party);
      setAutoRotate(false);
    }
    setCountdown(5);
  };

  const isEmpty = !electorates.length && !partyLists.length;

  if (isEmpty) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">Close Calls</h1>
        <p className="text-muted-foreground animate-pulse-soft font-semibold">Waiting for data…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Close Calls</h1>
          <div className="h-1 w-16 bg-gradient-brand rounded-full mt-1.5" />
        </div>
        <div className="flex items-center gap-3">
          {view === 'list' && majorParties.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-bold tabular-nums">
              <span className="text-muted-foreground">Next in</span>
              <span
                className={cn(
                  'w-7 h-7 flex items-center justify-center rounded-lg',
                  autoRotate
                    ? 'bg-muted text-foreground'
                    : 'bg-muted text-muted-foreground/50'
                )}
              >
                {autoRotate ? countdown : '—'}
              </span>

            </div>
          )}
          <Toggle
            options={[
              { value: 'electorates', label: 'Electorate Races' },
              { value: 'list', label: 'List Cut Lines' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      {view === 'electorates' ? (
        <div className={cn(
          'rounded-xl border bg-card p-4 sm:p-6 opacity-0 animate-fade-in-up shadow-sm'
        )}
        >
          <ElectorateRacesView electorates={electorates} />
        </div>
      ) : (
        <ListCutLinesView
          partyLists={partyLists}
          electorateResults={electorates}
          selectedParty={selectedParty}
          majorParties={majorParties}
          otherParties={otherParties}
          onPartyClick={handlePartyClick}
        />
      )}
    </div>
  );
}
