import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResults } from '../hooks/useResults.js';
import { usePriorWinners } from '../hooks/useVoteHistory.js';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { useHorizontalOverflow } from '../hooks/useHorizontalOverflow.js';
import { Pagination } from '../components/Pagination.js';
import { WaitingState } from '../components/WaitingState.js';
import { partyColor } from '../lib/constants.js';
import { normalizeElectorateName } from '../lib/electorates.js';
import {
  Th,
  TH_PINNED,
  TH_PINNED_MOVED,
  TR_ROW,
  TR_ROW_HOVER,
  TR_CLICKABLE,
  NUMERIC,
  NUMERIC_CELL,
  PINNED,
  PINNED_MOVED,
  TABLE_FRAME,
  TABLE_SCROLL,
  TABLE_TEXT,
} from '../components/Table.js';
import { cn } from '../lib/utils.js';
import { WinPercentLink } from '../components/WinPercentLink.js';
import {
  WinPercentValue,
  chancePercent,
  winPercentTitle,
} from '../components/WinPercentValue.js';
import type { PriorWinner } from '../lib/history-types.js';
import { PartyDot } from '../components/PartyDot.js';
import { PageHead, PageWaiting } from '../components/Page.js';
import { canonicalParty } from '@election-night/core/seat-probability';
import type { ElectorateResult } from '@election-night/core/types';

type FlippedSeat = { electorate: ElectorateResult; prior: PriorWinner };

/**
 * The margin and its share, folded under a candidate on a phone.
 *
 * It is the desktop cell's two lines at the phone's table scale: the figure
 * takes the cell's own 15px in mono, and the share drops one step to the
 * second-line 13px, the same relationship the wide table has (16px over 14px).
 * The words that name the figure take that same second-line size in the label
 * face, so the cell holds two sizes rather than three: it used to run an 11px
 * label, a 14px figure and a 13px share, which left the count and its own share
 * a single pixel apart and made the phrase look like fine print around a
 * number. A 15px figure also keeps the fold level with the candidate's name
 * above it, instead of reading as a footnote to it.
 */
function FoldedResult({
  label,
  value,
  share,
}: {
  label: string;
  value: number;
  share: number;
}) {
  return (
    <div className="mt-1 sm:hidden">
      <div className="whitespace-nowrap leading-snug">
        <span className="font-label text-[0.8125rem] font-normal text-muted-foreground">
          {label}
        </span>{' '}
        <span className={NUMERIC}>{value.toLocaleString()}</span>
      </div>
      <div
        className={cn(
          'whitespace-nowrap text-[0.8125rem] text-muted-foreground',
          NUMERIC
        )}
      >
        {(share * 100).toFixed(1)}%
      </div>
    </div>
  );
}

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
 *
 * General and Māori electorates share one list: a seat changing hands is the
 * same fact whatever roll it sits on, and splitting the two hid half the flips
 * behind a switch.
 */
export default function Flipped() {
  const navigate = useNavigate();
  const { results } = useResults();
  const {
    data: prior,
    error: priorError,
    loading: priorLoading,
  } = usePriorWinners();

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        .map((electorate) => ({
          electorate,
          prior: priorByElectorate.get(electorate.electorateName),
        }))
        .filter((row): row is FlippedSeat => !!row.prior),
    [electorates, priorByElectorate]
  );

  // …of which these changed hands, strongest lead first. Sorted by share of
  // the vote rather than raw votes so a 1,000-vote lead in a small electorate
  // does not outrank a larger one in a big city seat.
  const flipped = useMemo(
    () =>
      comparable
        .filter(({ electorate, prior: winner }) => {
          const leadingParty = electorate.leaders.leadingCandidateParty;
          // A seat with no leader has not changed hands: before the first
          // count the "leader" would be the feed's alphabetically first
          // candidate. A tie at the top is equally not a flip.
          if (!leadingParty) return false;
          // Compared as parties rather than as spellings: the Commission
          // renames a party between cycles, so 2020's "Māori Party" and
          // tonight's "Te Pāti Māori" are one party, and a string compare
          // listed Waiariki as a flip while Rawiri Waititi still held it.
          return canonicalParty(winner.party) !== canonicalParty(leadingParty);
        })
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

  // Below `sm` the table is wider than the phone: the margin and lead columns
  // are folded into the comparison cells, and the Win % column is reached by
  // swiping, so the fade says a column is still over there and the pinned
  // Electorate cell stays put while the others pass under it. Both are false on
  // wider screens, where everything fits. `visible.length` redraws the table
  // under a search, which changes its width.
  const { overflows, moreRight, scrolled } = useHorizontalOverflow(
    scrollRef,
    visible.length
  );

  // Narrowing the list starts at the first page again, but a results push
  // that merely re-renders the table must not move the reader.
  useEffect(() => {
    setPage(0);
  }, [query]);

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
      <PageHead title="Flipped" />

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
        <>
          <div className="relative">
            <label className="sr-only" htmlFor="flipped-search-input">
              Search flipped seats
            </label>
            <input
              id="flipped-search-input"
              type="text"
              placeholder="Search electorate…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border bg-background px-3 py-2 font-label text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/25 sm:py-1.5"
            />
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="kicker">
                {visible.length} of {comparable.length} seats
                {query.trim() ? ' matching' : ''}
              </span>
            </div>

            <div className="relative">
              <div
              ref={scrollRef}
              className={cn(overflows && TABLE_SCROLL, TABLE_FRAME)}
            >
                <table
                  className={cn(
                    // Wider than the phone below `sm`, so the Win % column is
                    // reached by swiping rather than dropped: the fold gives
                    // each comparison cell room for its words, and 26rem is
                    // where those words sit on one line with the numbers beside
                    // them. From `sm` up it is an ordinary full-width table.
                    'w-full min-w-[26rem] sm:min-w-0',
                    TABLE_TEXT
                  )}
                >
                  <thead>
                    <tr>
                      {/* Widths are fixed rather than left to the browser: with
                      auto layout the slack goes to whichever column has the
                      most text, and `Held` carries a third line (“· as Port
                      Hills”) that would hand it the room. On a phone both
                      comparison cells now carry words (“won by”, “leads by”)
                      beside their figures, so they take the largest shares and
                      the Electorate column gives way; from `sm` up the lead is
                      the column that should breathe, so it takes the largest
                      share again. The numeric columns stay auto — they only
                      need their digits. */}
                      <Th
                        align="left"
                        className={cn(
                          'w-[26%] px-2 sm:w-[19%] sm:px-3',
                          TH_PINNED,
                          scrolled && TH_PINNED_MOVED
                        )}
                      >
                        Electorate
                      </Th>
                      <Th
                        align="left"
                        className="w-[35%] px-2 sm:w-[24%] sm:px-3"
                      >
                        Held {primaryYear}
                      </Th>
                      <Th
                        align="right"
                        className="hidden px-2 sm:table-cell sm:px-3"
                      >
                        {primaryYear} margin
                      </Th>
                      <Th
                        align="left"
                        className="w-[39%] px-2 sm:w-[32%] sm:px-3"
                      >
                        Now leading
                      </Th>
                      {/* Below sm the margin and lead figures are folded into the
                      two comparison cells (see the row cells), so those columns
                      drop out; the chance does not — the table is wider than
                      the phone and scrolls to it. */}
                      <Th
                        align="right"
                        className="hidden px-2 sm:table-cell sm:px-3"
                      >
                        Lead
                      </Th>
                      {/* The chance is a qualifier, not part of the comparison, so
                      it goes last — and it stays on the phone, at the far end of
                      the swipe, because it is the number a reader came to
                      compare. */}
                      <Th align="right" className="px-2 sm:px-3">
                        <WinPercentLink />
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ electorate, prior: winner }, i) => {
                      const l = electorate.leaders;
                      const chance = chances.get(
                        normalizeElectorateName(electorate.electorateName)
                      );
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
                            TR_ROW,
                            TR_ROW_HOVER,
                            TR_CLICKABLE,
                            'animate-fade-in-up opacity-0'
                          )}
                          style={{ animationDelay: `${i * 0.03}s` }}
                        >
                          <td
                            className={cn(
                              'px-2 py-2 font-medium sm:px-3 sm:py-3',
                              PINNED,
                              scrolled && PINNED_MOVED
                            )}
                          >
                            <span className="transition-colors hover:underline">
                              {electorate.electorateName}
                            </span>
                          </td>
                          <td className="px-2 py-2 sm:px-3 sm:py-3">
                            <div className="flex items-center gap-1.5">
                              <PartyDot color={partyColor(winner.party)} />
                              <span className="font-medium">
                                {winner.candidate}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {winner.party ?? 'Independent'}
                              {winner.priorElectorateName
                                ? ` · as ${winner.priorElectorateName}`
                                : ''}
                            </div>
                            {/* Below `sm` the two numeric columns are gone, so
                              the pair they print folds into the comparison,
                              with the words that say which side it belongs to.
                              FoldedResult owns the type scale. */}
                            <FoldedResult
                              label="won by"
                              value={winner.majority}
                              share={winner.majorityPercent}
                            />
                          </td>
                          <td
                            className={cn(
                              'hidden px-2 py-2 sm:table-cell sm:px-3 sm:py-3',
                              NUMERIC,
                              NUMERIC_CELL
                            )}
                          >
                            <span>{winner.majority.toLocaleString()}</span>
                            <span className="block text-sm text-muted-foreground">
                              {(winner.majorityPercent * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-2 py-2 sm:px-3 sm:py-3">
                            <div className="flex items-center gap-1.5">
                              <PartyDot
                                color={partyColor(l.leadingCandidateParty)}
                              />
                              <span className="font-medium">
                                {l.leadingCandidate ?? '—'}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {l.leadingCandidateParty ?? 'Independent'}
                            </div>
                            {/* The same fold as the prior holder's cell, so the
                              two columns are read as one comparison — and the
                              words differ ("leads by" against "won by"), which
                              is what the two bare figures were missing. */}
                            <FoldedResult
                              label="leads by"
                              value={l.margin}
                              share={l.marginPercent}
                            />
                          </td>
                          <td
                            className={cn(
                              'hidden px-2 py-2 sm:table-cell sm:px-3 sm:py-3',
                              NUMERIC,
                              NUMERIC_CELL
                            )}
                          >
                            <span>{l.margin.toLocaleString()}</span>
                            <span className="block whitespace-nowrap text-sm text-muted-foreground">
                              {(l.marginPercent * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right sm:px-3 sm:py-3">
                            <WinPercentValue
                              percent={chancePercent(chance)}
                              title={winPercentTitle(chance)}
                              fallback={
                                <span
                                  className="text-muted-foreground"
                                  title="No votes counted yet"
                                >
                                  —
                                </span>
                              }
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
              {/* Drawn over the table's own right edge while there is more to
                  reach, and gone once the reader is at the end of it. */}
              {moreRight && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-foreground/15 via-foreground/5 to-transparent"
                />
              )}
            </div>

            <Pagination
              page={page}
              totalPages={totalPages}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </div>
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
