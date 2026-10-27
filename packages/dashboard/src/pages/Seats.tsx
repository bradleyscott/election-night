import { useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { partyColor } from '../lib/constants.js';
import { countProgress } from '../lib/seat-chance.js';
import { normalizeElectorateName } from '../lib/electorates.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber.js';
import { cn } from '../lib/utils.js';
import ParliamentSeats from '../components/ParliamentSeats.js';
import { WaitingState } from '../components/WaitingState.js';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';
import { PartyDot } from '../components/PartyDot.js';

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
        'p-2.5 sm:p-3 opacity-0 animate-fade-in-up',
        `stagger-${delay}`
      )}
    >
      <div className="kicker mb-1">{label}</div>
      <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight">
        {value !== null
          ? format
            ? format(animated)
            : Math.round(animated).toLocaleString()
          : '—'}
      </div>
    </div>
  );
}

/**
 * What the Certainty column means for a seat: the chance this candidate holds
 * it, not how far the lead is from a sampling error. Once the count is in,
 * there is no probability left to quote, so it states the margin the count
 * produced instead — as a share of the votes counted, the same definition of
 * margin the rest of the app uses.
 */
function ElectorateCertainty({
  chance,
  marginPercent,
}: {
  chance: SeatChance | null;
  marginPercent?: number | null;
}) {
  if (!chance || chance.state === 'waiting') {
    return <span className="text-muted-foreground">—</span>;
  }

  if (chance.state === 'complete') {
    if (marginPercent == null) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <span>
        {(marginPercent * 100).toFixed(1)}%
        <span className="text-muted-foreground"> margin</span>
      </span>
    );
  }

  return <span>{Math.round(chance.probability * 100)}%</span>;
}

function SuccessfulCandidates({
  electorateResults,
  partyLists,
  chances,
}: {
  electorateResults: {
    electorateName: string;
    leaders: {
      leadingCandidate: string;
      leadingCandidateParty: string | undefined;
      marginPercent: number;
    };
  }[];
  partyLists: (PartyList & WithAdjustedRank)[];
  chances?: Map<string, SeatChance>;
}) {
  type SortKey = 'name' | 'party' | 'certainty';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(() => {
    const winnerNames = new Set(
      electorateResults.map((e) => e.leaders.leadingCandidate)
    );

    const list: {
      name: string;
      party: string;
      electorateName: string | undefined;
      certainty: number;
      chance: SeatChance | null;
      marginPercent: number | null;
      isElectorate: boolean;
    }[] = [];

    for (const er of electorateResults) {
      const chance =
        chances?.get(normalizeElectorateName(er.electorateName)) ?? null;
      list.push({
        name: er.leaders.leadingCandidate,
        party: er.leaders.leadingCandidateParty ?? '',
        electorateName: er.electorateName,
        // A finished count is not a probability, so it sorts as certain.
        certainty:
          chance?.state === 'counting'
            ? chance.probability
            : chance?.state === 'complete'
              ? 1
              : 0,
        chance,
        marginPercent: er.leaders.marginPercent ?? null,
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
          chance: null,
          marginPercent: null,
          isElectorate: false,
        });
      }
    }

    const q = search.toLowerCase().trim();
    const filtered = q
      ? list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.electorateName?.toLowerCase().includes(q)
        )
      : list;

    filtered.sort((a, b) => {
      let cmp: number;
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
          className="w-full px-3 py-2 sm:py-1.5 border bg-background text-sm font-label outline-none focus:ring-2 focus:ring-ring/25 transition-shadow"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th
                className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSort('name')}
              >
                Candidate
                <SortIndicator column="name" />
              </th>
              <th
                className="hidden sm:table-cell text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSort('party')}
              >
                Party
                <SortIndicator column="party" />
              </th>
              <th className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Seat
              </th>
              <th
                className="hidden sm:table-cell text-right py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSort('certainty')}
              >
                Certainty
                <SortIndicator column="certainty" />
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr
                key={c.name}
                className={cn(
                  'border-b border-border last:border-0 transition-colors hover:bg-muted/30',
                  'opacity-0 animate-fade-in-up'
                )}
                style={{ animationDelay: `${i * 0.02}s` }}
              >
                <td className="py-2 sm:py-3 px-3 font-medium">
                  <div className="flex items-center gap-1.5">
                    <PartyDot
                      color={partyColor(c.party)}
                      className="sm:hidden"
                    />
                    {c.name}
                  </div>
                </td>
                <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                  <div className="flex items-center gap-1.5">
                    <PartyDot color={partyColor(c.party)} />
                    <span>{c.party || 'Independent'}</span>
                  </div>
                </td>
                <td className="py-2 sm:py-3 px-3">
                  {c.isElectorate ? (
                    <span className="flex items-center gap-1.5">
                      <span className="hidden sm:inline chip-print chip-print--ink">
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
                        className="chip-print chip-print--red hover:bg-muted/40 transition-colors"
                      >
                        List
                      </Link>
                      <span className="sm:hidden font-mono text-xs text-foreground tabular-nums">
                        +{Math.round(c.certainty)}
                      </span>
                    </span>
                  )}
                </td>
                <td className="hidden sm:table-cell py-2 sm:py-3 px-3 text-right font-mono tabular-nums">
                  {c.isElectorate ? (
                    <ElectorateCertainty
                      chance={c.chance}
                      marginPercent={c.marginPercent}
                    />
                  ) : (
                    <span className="text-foreground">
                      +{Math.round(c.certainty)} from cut
                    </span>
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
  const sorted = partyVote
    ? [...partyVote].sort((a, b) => b.seats - a.seats)
    : [];
  const totalSeats = sorted.reduce((s, p) => s + p.seats, 0);
  const partiesInParliament = sorted.filter((p) => p.seats > 0).length;

  const electorateResults = results?.electorateResults ?? [];
  // The chance of winning each seat, computed once for the whole table so a
  // row's number and the seat page's number come from the same call.
  const { electionYear, chances } = useSeatChances(electorateResults);

  // Counted votes and how far through the night that is. The denominator is
  // the votes these seats are expected to receive tonight, not the share of
  // voting places that have reported — places do not hold equal numbers of
  // votes, and advance votes land in blocks after 7pm.
  const progress = countProgress(electorateResults, electionYear);
  const overallVotePercentage =
    progress.fraction !== null ? progress.fraction * 100 : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="pagehead">
        <h1>Seats</h1>
      </div>

      {!results ? (
        <WaitingState variant="full" context="default" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 stat-grid">
            <AnimatedStat label="Total Seats" value={totalSeats} delay={1} />
            <AnimatedStat
              label="Parties in Parliament"
              value={partiesInParliament}
              delay={2}
            />
            <div
              className={cn(
                'p-2.5 sm:p-3 opacity-0 animate-fade-in-up stagger-3'
              )}
            >
              <div className="kicker mb-1">Votes counted</div>
              <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight tabular-nums">
                {progress.votesCounted.toLocaleString()}
              </div>
            </div>
            <div
              className={cn(
                'p-2.5 sm:p-3 opacity-0 animate-fade-in-up stagger-4'
              )}
            >
              <div className="kicker mb-1">Counted</div>
              <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight">
                {overallVotePercentage !== null
                  ? overallVotePercentage.toFixed(1) + '%'
                  : '—'}
              </div>
            </div>
          </div>

          <div
            className={cn(
              'border border-border p-4 sm:p-6 opacity-0 animate-fade-in-up stagger-5'
            )}
          >
            <ParliamentSeats
              partyVote={partyVote ?? []}
              electorateResults={results?.electorateResults ?? []}
              partyLists={
                (results?.partyLists ?? []) as (PartyList & WithAdjustedRank)[]
              }
              chances={chances}
            />
          </div>

          <div
            className={cn(
              'border border-border p-4 sm:p-6 opacity-0 animate-fade-in-up stagger-6'
            )}
          >
            <h2 className="font-display text-lg sm:text-xl font-bold mb-4 sm:mb-5 tracking-tight">
              Likely Parliamentarians
            </h2>
            <SuccessfulCandidates
              chances={chances}
              electorateResults={results?.electorateResults ?? []}
              partyLists={
                (results?.partyLists ?? []) as (PartyList & WithAdjustedRank)[]
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
