import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { usePriorWinners } from '../hooks/useVoteHistory.js';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { Toggle } from '../components/Toggle.js';
import { Pagination } from '../components/Pagination.js';
import { WaitingState } from '../components/WaitingState.js';
import { partyColor } from '../lib/constants.js';
import {
  isMaoriElectorate,
  normalizeElectorateName,
} from '../lib/electorates.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import { cn } from '../lib/utils.js';
import { Th } from '../components/Table.js';
import type { PriorWinner } from '../lib/history-types.js';
import { PartyDot } from '../components/PartyDot.js';
import { PageHead, PageWaiting } from '../components/Page.js';
import type { ElectorateResult } from '@election-night/core/types';

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

  // The same figure the seat page, the map, Seats and Close Calls quote, so no
  // two surfaces can disagree about one seat.
  const { chances } = useSeatChances(electorates);

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
    return <PageWaiting title="Flipped" context="electorates" />;
  }

  const open = (name: string) =>
    navigate(`/electorates/${encodeURIComponent(name)}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <PageHead title="Flipped" className="mb-0">
          <span className="kicker">
            {primaryYear
              ? `Seats changing hands since ${primaryYear}`
              : 'Seats changing hands'}
          </span>
        </PageHead>
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
            <table className="w-full text-base">
              <thead>
                <tr className="border-b">
                  {/* Widths are fixed rather than left to the browser: with
                      auto layout the slack goes to whichever column has the
                      most text, and `Held` carries a third line (“· as Port
                      Hills”) that would hand it the room. Tonight's lead is
                      the column that should breathe, so it gets the largest
                      share and the prior holder a readable minimum. The
                      numeric columns stay auto — they only need their
                      digits. */}
                  <Th align="left" className="w-[19%]">
                    Electorate
                  </Th>
                  <Th align="left" className="w-[24%]">
                    Held {primaryYear}
                  </Th>
                  <Th align="right" className="hidden sm:table-cell">
                    {primaryYear} margin
                  </Th>
                  <Th align="left" className="w-[32%]">
                    Now leading
                  </Th>
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
                          <PartyDot color={partyColor(winner.party)} />
                          <span className="font-semibold">
                            {winner.candidate}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {winner.party ?? 'Independent'}
                          {winner.priorElectorateName
                            ? ` · as ${winner.priorElectorateName}`
                            : ''}
                        </div>
                        <div className="text-sm text-muted-foreground tabular-nums sm:hidden">
                          majority {winner.majority.toLocaleString()} ·{' '}
                          {(winner.majorityPercent * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3 sm:py-3">
                        <span className="font-bold">
                          {winner.majority.toLocaleString()}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {(winner.majorityPercent * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3">
                        <div className="flex items-center gap-1.5">
                          <PartyDot
                            color={partyColor(l.leadingCandidateParty)}
                          />
                          <span className="font-semibold">
                            {l.leadingCandidate}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {l.leadingCandidateParty ?? 'Independent'}
                        </div>
                        <div className="text-sm text-muted-foreground tabular-nums sm:hidden">
                          leads {l.margin.toLocaleString()} ·{' '}
                          {(l.marginPercent * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3 sm:py-3">
                        <span className="font-bold">
                          {l.margin.toLocaleString()}
                        </span>
                        <span className="block whitespace-nowrap text-sm text-muted-foreground">
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
 *
 * A finished count gets a word rather than 100%: specials are still to come
 * (21% of all votes in 2023, and they moved seats), so a finished count is not
 * a result, and 100% under this header is the call the count has not made.
 * `Complete` states the one thing that is true, in the space the numbers above
 * it occupy.
 */
function WinPercentCell({ chance }: { chance?: SeatChance }) {
  if (chance?.state === 'counting') {
    return (
      <span className="font-bold tabular-nums">
        {Math.round(chance.probability * 100)}%
      </span>
    );
  }

  if (chance?.state === 'complete') {
    return (
      <span
        className="text-xs font-bold tabular-nums"
        title="Tonight's count is complete for this seat — special votes are still to come"
      >
        Complete
      </span>
    );
  }

  return (
    <span className="text-muted-foreground" title="No votes counted yet">
      &mdash;
    </span>
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
