import { cn } from '../lib/utils.js';
import { partyColors } from '../lib/constants.js';
import type {
  ElectorateResults,
  VotingResults,
  WithLeaders,
  WithMarginOfError,
  WithParty,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

function hasParty(
  v: VotingResults | (VotingResults & WithParty)
): v is VotingResults & WithParty {
  return 'party' in v;
}

export function ElectorateResultsTable({
  result,
  showPartyVote,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
}) {
  const rows = (
    showPartyVote
      ? [...result.partyVotes]
      : [...result.candidateVotes]
  ).sort((a, b) => b.votes - a.votes);

  return (
    <div className="border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              {showPartyVote ? (
                <th className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                  Party
                </th>
              ) : (
                <th className="text-left py-2 sm:py-3 px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                  Candidate
                </th>
              )}
              {!showPartyVote && (
                <th className="text-left px-2 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                  Party
                </th>
              )}
              <th className="text-right px-2 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Votes
              </th>
              <th className="text-right px-3 font-label font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr
                key={c.candidate}
                className={cn(
                  'border-b last:border-0 transition-colors hover:bg-muted/30',
                  i === 0 ? 'font-bold' : 'font-semibold',
                  'opacity-0 animate-fade-in-up'
                )}
                style={{ animationDelay: `${0.3 + i * 0.05}s` }}
              >
                {showPartyVote ? (
                  <td className="py-2 sm:py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 flex-shrink-0 ring-1 ring-foreground/15"
                        style={{
                          backgroundColor: partyColors[c.candidate] || '#666',
                        }}
                      />
                      {c.candidate}
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="py-2 sm:py-3 px-3">{c.candidate}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-2 h-2 flex-shrink-0 ring-1 ring-foreground/15"
                          style={{
                            backgroundColor:
                              partyColors[hasParty(c) ? (c.party ?? '') : ''] ||
                              '#666',
                          }}
                        />
                        {hasParty(c) ? (c.party ?? 'Independent') : 'Independent'}
                      </div>
                    </td>
                  </>
                )}
                <td className="text-right px-2 tabular-nums">
                  {c.votes.toLocaleString()}
                </td>
                <td className="text-right px-3 tabular-nums">
                  {((c.votes / result.votesCounted) * 100).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
