import { cn } from '../lib/utils.js';
import { partyColor } from '../lib/constants.js';
import type {
  VotingResults,
  WithParty,
  ElectorateResult,
} from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';
import { PartyDot } from './PartyDot.js';
import { Th, TH_CLASS } from './Table.js';

function hasParty(
  v: VotingResults | (VotingResults & WithParty)
): v is VotingResults & WithParty {
  return 'party' in v;
}

/**
 * What each candidate is worth, by name, for the two the model prices.
 *
 * The runner-up's cell is what is left after the leader *and* everyone else, so
 * the column never claims more than 100 between two candidates: a three-way seat
 * shows e.g. 40% and 30%, and the gap is the rest of the field's chance, which
 * the caption names. The old card printed `1 − p` and so credited the runner-up
 * with the field's chance too.
 */
function chanceByCandidate(
  chance: SeatChance | null | undefined
): Record<string, number> | null {
  if (!chance || chance.state === 'waiting') return null;
  const others = chance.state === 'counting' ? chance.othersProbability : 0;
  return {
    [chance.leader.name]: chance.probability,
    [chance.runnerUp.name]: Math.max(0, 1 - chance.probability - others),
  };
}

/**
 * The count, one row per candidate, ordered by votes.
 *
 * The ordering is the count's and stays that way: a table sorted by chance
 * would have to hide the vote counts that explain the chance, and the chance is
 * a projection onto votes that have not been cast yet. So when the projection
 * favours a candidate who is behind, the table states both facts on one line —
 * 8,019 votes beside 62% — instead of putting the two in separate panels that
 * face opposite ways.
 *
 * Below `sm` the party is folded under the candidate's name and the party
 * column is dropped. That was the difference between five columns overflowing a
 * 390px phone and four fitting it: the two widest columns were the two least
 * important, and a name is the one thing a row cannot do without.
 */
export function ElectorateResultsTable({
  result,
  showPartyVote,
  chance,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
  /**
   * The seat's chance, for the Win % column. Absent or `waiting` renders the
   * count only — a column of dashes is noise before the first result.
   */
  chance?: SeatChance | null;
}) {
  const rows = (
    showPartyVote ? [...result.partyVotes] : [...result.candidateVotes]
  ).sort((a, b) => b.votes - a.votes);

  // The seat is decided on the candidate vote, so a party view has no chance to
  // print: a party can contest the party vote in a seat it nominates no
  // candidate for.
  const chances = showPartyVote ? null : chanceByCandidate(chance);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm sm:text-base">
        <thead>
          <tr className="border-b">
            {showPartyVote ? <Th>Party</Th> : <Th>Candidate</Th>}
            {!showPartyVote && (
              <th className={cn(TH_CLASS, 'hidden px-2 sm:table-cell')}>
                Party
              </th>
            )}
            <Th align="right" className="whitespace-nowrap">
              Votes
            </Th>
            <Th align="right">%</Th>
            {chances && (
              <Th align="right" className="whitespace-nowrap">
                Win %
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const partied = hasParty(c) ? (c.party ?? 'Independent') : null;
            const share = chances?.[c.candidate];
            return (
              <tr
                key={c.candidate}
                className={cn(
                  'border-b last:border-0 transition-colors hover:bg-muted/30',
                  i === 0 ? 'font-bold' : 'font-semibold'
                )}
              >
                {showPartyVote ? (
                  <td className="px-3 py-2 sm:py-3">
                    <div className="flex items-center gap-1.5">
                      <PartyDot color={partyColor(c.candidate)} />
                      {c.candidate}
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="py-2 pl-3 pr-2 sm:whitespace-nowrap sm:py-3">
                      <div className="leading-tight">{c.candidate}</div>
                      {/* The same `party` field the column below prints: below
                          `sm` the column is gone and this line takes its
                          place, rather than the name losing the party. */}
                      <div className="mt-0.5 flex items-center gap-1.5 font-label text-[11px] font-normal text-muted-foreground sm:hidden">
                        <PartyDot color={partyColor(partied)} />
                        {partied ?? 'Independent'}
                      </div>
                    </td>
                    <td className="hidden px-2 sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <PartyDot color={partyColor(partied)} />
                        {partied ?? 'Independent'}
                      </div>
                    </td>
                  </>
                )}
                <td className="px-2 text-right tabular-nums whitespace-nowrap">
                  {c.votes.toLocaleString()}
                </td>
                <td className="px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                  {result.votesCounted > 0
                    ? `${((c.votes / result.votesCounted) * 100).toFixed(1)}%`
                    : '—'}
                </td>
                {chances && (
                  <td className="py-2 pl-2 pr-3 text-right whitespace-nowrap">
                    {share === undefined ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        —
                      </span>
                    ) : (
                      // The number is the reading. A 56px track under it was
                      // drawn here first and removed: it cost the candidate name
                      // enough width to wrap, and at that size a bar cannot show
                      // the difference between 73% and 71% anyway.
                      <div
                        className="font-display text-base font-bold leading-none tabular-nums sm:text-lg"
                        title={`${Math.round(share * 100)}% chance of winning the seat`}
                      >
                        {Math.round(share * 100)}
                        <span className="text-xs">%</span>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
