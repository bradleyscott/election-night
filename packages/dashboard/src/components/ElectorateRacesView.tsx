import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { partyColor } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from './WaitingState.js';
import { Pagination } from './Pagination.js';
import { normalizeElectorateName } from '../lib/electorates.js';
import type { ElectorateResult } from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';
import { PartyDot } from './PartyDot.js';
import {
  Th,
  TR_ROW,
  TR_ROW_HOVER,
  TR_CLICKABLE,
  NUMERIC,
  NUMERIC_CELL,
  TABLE_FRAME,
  TABLE_TEXT,
} from './Table.js';
import { WinPercentLink } from './WinPercentLink.js';
import {
  WinPercentValue,
  chancePercent,
  winPercentTitle,
} from './WinPercentValue.js';

const PAGE_SIZE = 10;

export function ElectorateRacesView({
  electorates,
  chances,
}: {
  electorates: ElectorateResult[];
  chances?: Map<string, SeatChance>;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  // Closest first still, but "close" is now the chance of losing rather than
  // the distance between the top two. A seat with a 12% lead and a 99% chance
  // is not a close call; a seat 300 votes apart at 39% counted is.
  const sorted = useMemo(() => {
    const rank = (er: ElectorateResult) => {
      const chance = chances?.get(normalizeElectorateName(er.electorateName));
      // A finished count still has a chance — the special vote is uncounted —
      // so it ranks on that number like any other seat. Treating it as settled
      // put the closest call of the night last, and the column beside it now
      // prints the same probability the rank uses.
      if (chance?.state === 'counting' || chance?.state === 'complete') {
        return chance.probability;
      }
      // An uncounted seat is not a close call.
      return 1.5;
    };
    return [...electorates].sort((a, b) => rank(a) - rank(b));
  }, [electorates, chances]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageResults = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [totalPages, page]);

  if (!sorted.length) {
    return <WaitingState variant="compact" context="closecalls" />;
  }

  return (
    <div>
      <div className={cn('overflow-x-auto', TABLE_FRAME)}>
        <table className={cn('w-full', TABLE_TEXT)}>
          <thead>
            <tr className="border-b">
              <Th>Electorate</Th>
              <Th>Leading</Th>
              <Th className="hidden sm:table-cell">Second</Th>
              <Th align="right" className="hidden sm:table-cell px-3">
                Lead
              </Th>
              <Th align="right" className="px-3">
                Lead %
              </Th>
              <Th align="right" className="px-3">
                <WinPercentLink />
              </Th>
            </tr>
          </thead>
          <tbody>
            {pageResults.map((er, i) => {
              const l = er.leaders;
              const chance = chances?.get(
                normalizeElectorateName(er.electorateName)
              );
              return (
                <tr
                  key={er.electorateName}
                  tabIndex={0}
                  role="button"
                  aria-label={`View details for ${er.electorateName}`}
                  onClick={() =>
                    navigate(
                      `/electorates/${encodeURIComponent(er.electorateName)}`
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(
                        `/electorates/${encodeURIComponent(er.electorateName)}`
                      );
                    }
                  }}
                  className={cn(
                    TR_ROW,
                    TR_ROW_HOVER,
                    TR_CLICKABLE,
                    'opacity-0 animate-fade-in-up'
                  )}
                  style={{ animationDelay: `${i * 0.03}s` }}
                >
                  <td className="py-2 sm:py-3 px-3 font-semibold">
                    <span className="hover:underline transition-colors">
                      {er.electorateName}
                    </span>
                  </td>
                  <td className="py-2 sm:py-3 px-3">
                    {l.leadingCandidate ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <PartyDot
                            color={partyColor(l.leadingCandidateParty)}
                          />
                          <span className="font-semibold">
                            {l.leadingCandidate}
                          </span>
                        </div>
                        {/* Named, not just dotted: a swatch is not a party name,
                            and the Flipped table already prints both. */}
                        <div className="text-sm text-muted-foreground">
                          {l.leadingCandidateParty ?? 'Independent'}
                        </div>
                      </>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="No votes counted yet"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                    {l.secondCandidate ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <PartyDot
                            color={partyColor(l.secondCandidateParty)}
                          />
                          <span className="text-muted-foreground">
                            {l.secondCandidate}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {l.secondCandidateParty ?? 'Independent'}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'hidden sm:table-cell py-2 sm:py-3 px-3 font-bold',
                      NUMERIC,
                      NUMERIC_CELL
                    )}
                  >
                    {l.leadingCandidate ? l.margin.toLocaleString() : '—'}
                  </td>
                  <td
                    className={cn(
                      'py-2 sm:py-3 px-3 font-bold',
                      NUMERIC,
                      NUMERIC_CELL
                    )}
                  >
                    {l.leadingCandidate
                      ? `${(l.marginPercent * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td
                    className={cn('py-2 sm:py-3 px-3', NUMERIC, NUMERIC_CELL)}
                  >
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
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
