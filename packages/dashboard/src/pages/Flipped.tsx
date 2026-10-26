import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { useApi } from '../hooks/useApi.js';
import { usePriorWinners } from '../hooks/useVoteHistory.js';
import { Toggle } from '../components/Toggle.js';
import { Pagination } from '../components/Pagination.js';
import { WaitingState } from '../components/WaitingState.js';
import { partyColors } from '../lib/constants.js';
import {
  isMaoriElectorate,
  normalizeElectorateName,
} from '../lib/electorates.js';
import {
  nationalSwingOf,
  seatChanceFor,
  type ElectorateResult,
} from '../lib/seat-chance.js';
import { cn } from '../lib/utils.js';
import type { RuntimeConfig } from '@election-night/core/polls-close';
import type { SeatChance } from '@election-night/core/seat-probability';
import type { PriorWinner } from '../lib/history-types.js';

type FlippedSeat = { electorate: ElectorateResult; prior: PriorWinner };

/** Rows per page, matching the Close Calls table. */
const PAGE_SIZE = 10;

/**
 * Seats held by one party after the last election that a different party is
 * leading now.
 *
 * The comparison is only drawn for seats that continued under the same
 * electoral area: the collector matches prior winners to today's electorates
 * through the rename table and drops seats created by a merge or split, so
 * every row here is an honest "held by X, now leading Y". Seats with no prior
 * holder are absent rather than guessed at.
 */
export default function Flipped() {
  const navigate = useNavigate();
  const { results } = useResults();
  const {
    data: prior,
    error: priorError,
    loading: priorLoading,
  } = usePriorWinners();

  const [showMaori, setShowMaori] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const electorates = (results?.electorateResults ?? []) as ElectorateResult[];
  const { data: config } = useApi<RuntimeConfig>('/api/config');

  // The same figure the seat page, the map, Seats and Close Calls quote, so no
  // two surfaces can disagree about one seat.
  const electionYear = config?.electionYear ?? null;
  const nationalSwing = useMemo(
    () => nationalSwingOf(electorates, electionYear),
    [electorates, electionYear]
  );
  const chances = useMemo(() => {
    const map = new Map<string, SeatChance>();
    for (const result of electorates) {
      map.set(
        normalizeElectorateName(result.electorateName),
        seatChanceFor(result, electionYear, nationalSwing)
      );
    }
    return map;
  }, [electorates, electionYear, nationalSwing]);

  const primaryYear = prior?.primaryYear ?? null;

  const priorByElectorate = useMemo(() => {
    const year = prior?.years.find((y) => y.year === primaryYear);
    return new Map((year?.winners ?? []).map((w) => [w.electorateName, w]));
  }, [prior, primaryYear]);

  // Seats in this chamber that have a comparable prior holder at all…
  const comparable = useMemo(
    () =>
      electorates
        .filter((e) => showMaori === isMaoriElectorate(e.electorateName))
        .map((electorate) => ({
          electorate,
          prior: priorByElectorate.get(electorate.electorateName),
        }))
        .filter((row): row is FlippedSeat => !!row.prior),
    [electorates, priorByElectorate, showMaori]
  );

  // …of which these changed hands, strongest lead first. Sorted by share of
  // the vote rather than raw votes so a 1,000-vote lead in a small electorate
  // does not outrank a larger one in a big city seat.
  const flipped = useMemo(
    () =>
      comparable
        .filter(
          ({ electorate, prior: winner }) =>
            (winner.party ?? null) !==
            (electorate.leaders.leadingCandidateParty ?? null)
        )
        .sort(
          (a, b) =>
            b.electorate.leaders.marginPercent -
            a.electorate.leaders.marginPercent
        ),
    [comparable]
  );

  const visible = useMemo(() => {
    // Normalised, so typing "otahuhu" finds Ōtāhuhu — the same rule the feed
    // and the boundary data are matched with.
    const term = normalizeElectorateName(query);
    if (!term) return flipped;
    return flipped.filter(({ electorate }) =>
      normalizeElectorateName(electorate.electorateName).includes(term)
    );
  }, [flipped, query]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Narrowing the list starts at the first page again, but a results push
  // that merely re-renders the table must not move the reader.
  useEffect(() => {
    setPage(0);
  }, [query, showMaori]);

  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [totalPages, page]);

  if (!electorates.length) {
    return (
      <div className="animate-fade-in">
        <div className="pagehead">
          <h1>Flipped</h1>
        </div>
        <WaitingState context="electorates" />
      </div>
    );
  }

  const open = (name: string) =>
    navigate(`/electorates/${encodeURIComponent(name)}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="pagehead mb-0">
          <h1>Flipped</h1>
          <span className="kicker">
            {primaryYear
              ? `Seats changing hands since ${primaryYear}`
              : 'Seats changing hands'}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative w-full text-sm sm:w-auto">
            <label className="sr-only" htmlFor="flipped-search-input">
              Search flipped seats
            </label>
            <input
              id="flipped-search-input"
              type="text"
              placeholder="Search electorate…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border bg-background px-3 py-2 font-label text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/25 sm:w-56 sm:py-1.5"
            />
          </div>
          <Toggle
            options={[
              { value: 'general', label: 'General' },
              { value: 'maori', label: 'Māori' },
            ]}
            value={showMaori ? 'maori' : 'general'}
            onChange={(v) => setShowMaori(v === 'maori')}
          />
        </div>
      </div>

      {priorLoading ? (
        <WaitingState variant="compact" context="electorates" />
      ) : priorError || !primaryYear ? (
        <Notice title="Prior results unavailable">
          Previous election results could not be fetched, so seats cannot be
          compared. This page fills in once the archive is reachable.
        </Notice>
      ) : flipped.length === 0 ? (
        <Notice title={`No seats have changed hands since ${primaryYear}`}>
          Every comparable seat is still being led by the party that won it in{' '}
          {primaryYear}.
        </Notice>
      ) : (
        <div className="border">
          <div className="flex items-baseline justify-between gap-3 border-b px-3 py-2 sm:px-4">
            <span className="kicker">
              {visible.length} of {comparable.length} seats
              {query.trim() ? ' matching' : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th align="left">Electorate</Th>
                  <Th align="left">Held {primaryYear}</Th>
                  <Th align="right" className="hidden sm:table-cell">
                    {primaryYear} margin
                  </Th>
                  <Th align="left">Now leading</Th>
                  {/* Below sm the numbers are folded into the two comparison
                      columns (see the row cells), so only the margin and
                      chance columns drop out — the lead stays visible. */}
                  <Th align="right" className="hidden sm:table-cell">
                    Lead
                  </Th>
                  {/* The chance is a qualifier, not part of the comparison, so
                      it goes last. */}
                  <Th align="right" className="hidden sm:table-cell">
                    Win %
                  </Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ electorate, prior: winner }, i) => {
                  const l = electorate.leaders;
                  return (
                    <tr
                      key={electorate.electorateName}
                      tabIndex={0}
                      role="button"
                      aria-label={`View details for ${electorate.electorateName}`}
                      onClick={() => open(electorate.electorateName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          open(electorate.electorateName);
                        }
                      }}
                      className={cn(
                        'animate-fade-in-up border-b opacity-0 transition-colors last:border-0 hover:bg-muted/20',
                        'cursor-pointer focus:bg-muted/20 focus:outline-none focus:ring-2 focus:ring-ring/25'
                      )}
                      style={{ animationDelay: `${i * 0.03}s` }}
                    >
                      <td className="px-2 py-2 font-semibold sm:px-3 sm:py-3">
                        <span className="transition-colors hover:underline">
                          {electorate.electorateName}
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3">
                        <div className="flex items-center gap-1.5">
                          <PartyDot party={winner.party} />
                          <span className="font-semibold">
                            {winner.candidate}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {winner.party ?? 'Unknown'}
                          {winner.priorElectorateName
                            ? ` · as ${winner.priorElectorateName}`
                            : ''}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                          majority {winner.majority.toLocaleString()} ·{' '}
                          {(winner.majorityPercent * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3 sm:py-3">
                        <span className="font-bold">
                          {winner.majority.toLocaleString()}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {(winner.majorityPercent * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3">
                        <div className="flex items-center gap-1.5">
                          <PartyDot party={l.leadingCandidateParty} />
                          <span className="font-semibold">
                            {l.leadingCandidate}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {l.leadingCandidateParty ?? 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                          leads {l.margin.toLocaleString()} ·{' '}
                          {(l.marginPercent * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3 sm:py-3">
                        <span className="font-bold">
                          {l.margin.toLocaleString()}
                        </span>
                        <span className="block whitespace-nowrap text-xs text-muted-foreground">
                          {(l.marginPercent * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="hidden px-2 py-2 text-right sm:table-cell sm:px-3 sm:py-3">
                        <WinPercentCell
                          chance={chances.get(
                            normalizeElectorateName(electorate.electorateName)
                          )}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {visible.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
                No flipped seats match “{query.trim()}”.
              </p>
            )}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

/**
 * The chance the leader holds the seat. A margin of error describes a sample,
 * and a count part-way through is not a sample — the honest figure is how
 * likely the lead is to survive the votes still to count.
 */
function WinPercentCell({ chance }: { chance?: SeatChance }) {
  if (chance?.state === 'counting') {
    return (
      <span className="font-bold tabular-nums">
        {Math.round(chance.probability * 100)}%
      </span>
    );
  }

  return (
    <span
      className="text-muted-foreground"
      title={
        chance?.state === 'complete'
          ? "Tonight's count is complete for this seat"
          : 'No votes counted yet'
      }
    >
      &mdash;
    </span>
  );
}

function PartyDot({ party }: { party: string | undefined | null }) {
  return (
    <div
      className="h-2 w-2 flex-shrink-0 ring-1 ring-foreground/15"
      style={{ backgroundColor: partyColors[party ?? ''] || '#666' }}
    />
  );
}

function Th({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 font-label text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:py-3',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
    >
      {children}
    </th>
  );
}

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border px-4 py-8 text-center">
      <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
