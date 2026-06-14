import { useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { partyColors } from '../lib/constants.js';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber.js';
import { cn } from '../lib/utils.js';
import ParliamentSeats from '../components/ParliamentSeats.js';
import { WaitingState } from '../components/WaitingState.js';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';

function AnimatedStat({
  label,
  value,
  format,
  delay,
}: {
  label: string;
  value: number | null;
  format?: (v: number) => string;
  delay: number;
}) {
  const animated = useAnimatedNumber(value ?? 0);

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-2 sm:p-2.5 opacity-0 animate-fade-in-up',
        'shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300',
        `stagger-${delay}`
      )}
    >
      <div className="text-xs sm:text-xs text-muted-foreground font-semibold mb-0 tracking-wide uppercase">
        {label}
      </div>
      <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold tabular-nums tracking-tight">
        {value !== null ? (format ? format(animated) : Math.round(animated).toLocaleString()) : '—'}
      </div>
    </div>
  );
}

function shortNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

function SuccessfulCandidates({
  electorateResults,
  partyLists,
}: {
  electorateResults: {
    electorateName: string;
    leaders: {
      leadingCandidate: string;
      leadingCandidateParty: string | undefined;
      marginPercent: number;
    };
    marginOfError: number;
  }[];
  partyLists: (PartyList & WithAdjustedRank)[];
}) {
  type SortKey = 'name' | 'party' | 'certainty';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(() => {
    const winnerNames = new Set(electorateResults.map((e) => e.leaders.leadingCandidate));

    const list: {
      name: string;
      party: string;
      electorateName: string | undefined;
      certainty: number;
      marginOfError: number | undefined;
      isElectorate: boolean;
    }[] = [];

    for (const er of electorateResults) {
      list.push({
        name: er.leaders.leadingCandidate,
        party: er.leaders.leadingCandidateParty ?? '',
        electorateName: er.electorateName,
        certainty: er.leaders.marginPercent,
        marginOfError: er.marginOfError,
        isElectorate: true,
      });
    }

    for (const pl of partyLists) {
      if (pl.distanceFromCut >= 0 && !winnerNames.has(pl.candidate)) {
        list.push({
          name: pl.candidate,
          party: pl.party,
          electorateName: undefined,
          certainty: pl.distanceFromCut,
          marginOfError: undefined,
          isElectorate: false,
        });
      }
    }

    const q = search.toLowerCase().trim();
    const filtered = q
      ? list.filter((c) => c.name.toLowerCase().includes(q) || c.electorateName?.toLowerCase().includes(q))
      : list;

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'party') cmp = a.party.localeCompare(b.party);
      else cmp = a.certainty - b.certainty;
      return sortDesc ? -cmp : cmp;
    });

    return filtered;
  }, [electorateResults, partyLists, sortKey, sortDesc, search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(key === 'certainty');
    }
  }

  function SortIndicator({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return <span className="ml-1 text-xs">{sortDesc ? '↓' : '↑'}</span>;
  }

  if (!electorateResults.length && !partyLists.length) {
    return <WaitingState variant="compact" context="candidates" />;
  }

  return (
    <div>
      <div className="relative mb-3 sm:mb-4">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search candidate or electorate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 sm:py-1.5 border rounded-lg bg-background text-sm font-semibold outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 transition-shadow"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th
                className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSort('name')}
              >
                Candidate<SortIndicator column="name" />
              </th>
              <th
                className="hidden sm:table-cell text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSort('party')}
              >
                Party<SortIndicator column="party" />
              </th>
              <th className="text-left py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
                Seat
              </th>
              <th
                className="hidden sm:table-cell text-right py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSort('certainty')}
              >
                Certainty<SortIndicator column="certainty" />
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr
                key={c.name}
                className={cn(
                  'border-b last:border-0 transition-colors hover:bg-muted/20',
                  'opacity-0 animate-fade-in-up'
                )}
                style={{ animationDelay: `${i * 0.02}s` }}
              >
                <td className="py-2 sm:py-3 px-3 font-semibold">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10 sm:hidden"
                      style={{ backgroundColor: partyColors[c.party] || '#666' }}
                    />
                    {c.name}
                  </div>
                </td>
                <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                      style={{ backgroundColor: partyColors[c.party] || '#666' }}
                    />
                    <span>{c.party || 'Independent'}</span>
                  </div>
                </td>
                <td className="py-2 sm:py-3 px-3">
                  {c.isElectorate ? (
                    <span className="flex items-center gap-1.5">
                      <span className="hidden sm:inline rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase leading-none">
                        Electorate
                      </span>
                      <Link
                        to={`/electorates/${encodeURIComponent(c.electorateName ?? '')}`}
                        className="text-muted-foreground hover:text-foreground hover:underline transition-colors"
                      >
                        {c.electorateName}
                      </Link>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Link
                        to={`/parties?party=${encodeURIComponent(c.party)}`}
                        className="rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase leading-none hover:bg-purple-200 dark:hover:bg-purple-800/60 transition-colors"
                      >
                        List
                      </Link>
                      <span className="sm:hidden text-green-600 dark:text-green-400 text-xs font-bold tabular-nums">
                        +{Math.round(c.certainty)}
                      </span>
                    </span>
                  )}
                </td>
                <td className="hidden sm:table-cell py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                  {c.isElectorate ? (
                    <span>
                      {(c.certainty * 100).toFixed(1)}%{' '}
                      <span className="text-muted-foreground font-semibold whitespace-nowrap">
                        ± {(c.marginOfError! * 100).toFixed(1)}%
                      </span>
                    </span>
                  ) : (
                    <span className="text-green-600 dark:text-green-400">+{Math.round(c.certainty)} from cut</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Seats() {
  const { results } = useResults();

  const partyVote = results?.partyVote;
  const sorted = partyVote?.sort((a, b) => b.seats - a.seats) ?? [];
  const totalSeats = sorted.reduce((s, p) => s + p.seats, 0);
  const partiesInParliament = sorted.filter((p) => p.seats > 0).length;

  const electorateResults = results?.electorateResults ?? [];
  const totalVotesCounted = electorateResults.reduce((s, e) => s + e.votesCounted, 0);
  const totalVotesEstimate = electorateResults.reduce(
    (s, e) => s + e.votesCounted / (e.votePercentageCounted || 1),
    0
  );
  const overallVotePercentage =
    totalVotesCounted > 0
      ? (totalVotesCounted / totalVotesEstimate) * 100
      : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Seats
          </h1>
          <div className="h-1 w-16 bg-gradient-brand rounded-full mt-1.5" />
        </div>
      </div>

      {!results ? (
        <WaitingState variant="full" context="default" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5">
            <AnimatedStat
              label="Total Seats"
              value={totalSeats}
              delay={1}
            />
            <AnimatedStat
              label="Parties in Parliament"
              value={partiesInParliament}
              delay={2}
            />
            <AnimatedStat
              label="Votes cast"
              value={Math.round(totalVotesEstimate)}
              format={shortNumber}
              delay={3}
            />
            <div
              className={cn(
                'rounded-xl border bg-card p-2 sm:p-2.5 opacity-0 animate-fade-in-up stagger-4',
                'shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300'
              )}
            >
              <div className="text-xs sm:text-xs text-muted-foreground font-semibold mb-0 tracking-wide uppercase">
                Votes Counted
              </div>
              <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold tabular-nums tracking-tight">
                {overallVotePercentage !== null ? overallVotePercentage.toFixed(1) + '%' : '—'}
              </div>
              <div className="text-xs sm:text-xs text-muted-foreground font-semibold mt-0">
                {totalVotesCounted > 0 ? shortNumber(totalVotesCounted) + ' votes' : ''}
              </div>
            </div>
          </div>

          <div
            className={cn(
              'rounded-xl border bg-card p-4 sm:p-6 opacity-0 animate-fade-in-up stagger-5',
              'shadow-sm'
            )}
          >
            <ParliamentSeats
              partyVote={partyVote ?? []}
              electorateResults={results?.electorateResults ?? []}
              partyLists={(results?.partyLists ?? []) as (PartyList & WithAdjustedRank)[]}
            />
          </div>

          <div
            className={cn(
              'rounded-xl border bg-card p-4 sm:p-6 opacity-0 animate-fade-in-up stagger-6',
              'shadow-sm'
            )}
          >
            <h2 className="text-base sm:text-lg font-extrabold mb-4 sm:mb-5 tracking-tight">
              Likely Parliamentarians
            </h2>
            <SuccessfulCandidates
              electorateResults={results?.electorateResults ?? []}
              partyLists={(results?.partyLists ?? []) as (PartyList & WithAdjustedRank)[]}
            />
          </div>
        </>
      )}
    </div>
  );
}