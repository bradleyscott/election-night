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
      if (chance?.state === 'counting') return chance.probability;
      // A finished count is not a probability, and an uncounted seat is not a
      // close call; both belong below every live race.
      return chance?.state === 'complete' ? 1 : 1.5;
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Electorate
              </th>
              <th className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Leading
              </th>
              <th className="hidden sm:table-cell text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Second
              </th>
              <th className="text-right py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Lead (votes)
              </th>
              <th className="text-right py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Lead %
              </th>
              <th className="text-right py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Win %
              </th>
            </tr>
          </thead>
          <tbody>
            {pageResults.map((er, i) => {
              const l = er.leaders;
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
                    'border-b last:border-0 transition-colors hover:bg-muted/20 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring/25 focus:bg-muted/20',
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
                    <div className="flex items-center gap-1.5">
                      <PartyDot color={partyColor(l.leadingCandidateParty)} />
                      <span className="font-semibold">
                        {l.leadingCandidate}
                      </span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <PartyDot color={partyColor(l.secondCandidateParty)} />
                      <span className="text-muted-foreground">
                        {l.secondCandidate}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                    {l.margin.toLocaleString()}
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                    {(l.marginPercent * 100).toFixed(2)}%
                  </td>
                  <td className="py-2 sm:py-3 px-3 text-right tabular-nums font-bold">
                    <WinPercentCell
                      chance={chances?.get(
                        normalizeElectorateName(er.electorateName)
                      )}
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

/**
 * The chance the leader holds the seat. A margin of error is a property of a
 * sample, and this is not a sample — it is a count part-way through, so the
 * honest figure is the chance the lead survives the votes still to come.
 */
function WinPercentCell({ chance }: { chance?: SeatChance }) {
  if (chance?.state === 'counting') {
    return <span>{Math.round(chance.probability * 100)}%</span>;
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
