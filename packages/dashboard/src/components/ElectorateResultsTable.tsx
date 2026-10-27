import { cn } from '../lib/utils.js';
import { partyColor } from '../lib/constants.js';
import type {
  VotingResults,
  WithParty,
  ElectorateResult,
} from '@election-night/core/types';
import { PartyDot } from './PartyDot.js';
import { Th, TH_CLASS } from './Table.js';

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
    showPartyVote ? [...result.partyVotes] : [...result.candidateVotes]
  ).sort((a, b) => b.votes - a.votes);

  return (
    <div className="border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              {showPartyVote ? <Th>Party</Th> : <Th>Candidate</Th>}
              {!showPartyVote && (
                <th className={cn(TH_CLASS, 'px-2')}>Party</th>
              )}
              <th className={cn(TH_CLASS, 'px-2')}>Votes</th>
              <th className={cn(TH_CLASS, 'px-3')}>%</th>
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
                      <PartyDot color={partyColor(c.candidate)} />
                      {c.candidate}
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="py-2 sm:py-3 px-3">{c.candidate}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-1.5">
                        <PartyDot
                          color={partyColor(hasParty(c) ? c.party : null)}
                        />
                        {hasParty(c)
                          ? (c.party ?? 'Independent')
                          : 'Independent'}
                      </div>
                    </td>
                  </>
                )}
                <td className="text-right px-2 tabular-nums">
                  {c.votes.toLocaleString()}
                </td>
                <td className="text-right px-3 tabular-nums">
                  {result.votesCounted > 0
                    ? ((c.votes / result.votesCounted) * 100).toFixed(1)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
