import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { partyColors } from '../lib/constants.js';
import { cn } from '../lib/utils.js';
import { WaitingState } from './WaitingState.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

const PAGE_SIZE = 10;

export function ElectorateRacesView({
  electorates,
}: {
  electorates: ElectorateResult[];
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const sorted = useMemo(
    () =>
      [...electorates].sort(
        (a, b) => a.leaders.marginPercent - b.leaders.marginPercent
      ),
    [electorates]
  );

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
              <th className="hidden sm:table-cell text-right py-2 sm:py-3 px-3 font-extrabold text-muted-foreground uppercase tracking-wide text-xs">
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
                  onClick={() =>
                    navigate(
                      `/electorates/${encodeURIComponent(er.electorateName)}`
                    )
                  }
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-muted/20 cursor-pointer',
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
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                        style={{
                          backgroundColor:
                            partyColors[l.leadingCandidateParty ?? ''] || '#666',
                        }}
                      />
                      <span className="font-semibold">{l.leadingCandidate}</span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-2 sm:py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/10"
                        style={{
                          backgroundColor:
                            partyColors[l.secondCandidateParty ?? ''] || '#666',
                        }}
                      />
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
                  <td className="hidden sm:table-cell py-2 sm:py-3 px-3 text-right tabular-nums font-bold text-muted-foreground">
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
