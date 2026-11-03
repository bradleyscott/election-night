import { partyColor } from '../lib/constants.js';
import type { PriorWinner } from '../lib/history-types.js';
import { cn } from '../lib/utils.js';
import { PartyDot } from './PartyDot.js';
import { TR_ROW, TABLE_TEXT_COMPACT } from './Table.js';

/**
 * The words in the margin cell — "vote margin" and "of votes cast" — are
 * labels, so they take the label font at one size. They used to disagree: the
 * first inherited the body's Crimson Pro while the second was set in mono with
 * the number, so at the same 14px the two lines read as two different sizes on
 * a phone. The figures beside them stay mono and tabular, and the two are
 * separated by the row's `gap-x-1.5` rather than a whitespace text node, whose
 * width changes with whichever face happens to render it.
 *
 * The panel runs on the count table's compact scale (`TABLE_TEXT_COMPACT`),
 * because its only call site is directly under that table, which is compact
 * below `sm` to fit five columns; at 15px rows this panel read larger than the
 * count it sits under. The candidate and party are set one point above that
 * scale on a phone, where the names are the panel's content.
 */
const MARGIN_LABEL = 'font-label text-xs text-muted-foreground sm:text-sm';

/**
 * Who held this seat in previous cycles.
 *
 * Only cycles where the same electoral area continues are shown: the collector
 * resolves renames before it matches seats, so a row here is a real prior
 * holder of this electorate, never a neighbouring seat's member. Where the
 * seat carried a different name in that cycle it is named — a comparison a
 * reader can audit rather than take on trust.
 *
 * Deliberately says nothing about who is leading tonight. Marking a past
 * result as "flipped" would assert a verdict against the current count, which
 * on election night is partial and can still change hands back; the flip view
 * is its own page, where the lead and its margin of error sit beside the
 * claim.
 */
export function PastWinners({
  winners,
  unavailable,
}: {
  /** This electorate's prior winners, newest cycle first. Empty when none. */
  winners: PriorWinner[];
  /** The collector could not derive any prior cycle. */
  unavailable: boolean;
}) {
  return (
    <div className="border">
      <div className="flex items-baseline justify-between gap-3 border-b px-3 py-2 sm:px-4">
        <h3 className="font-display text-base font-bold tracking-tight sm:text-lg">
          Past winners
        </h3>
        <span className="kicker">Final results</span>
      </div>

      {unavailable ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          Previous elections could not be fetched, so this seat&apos;s past
          winners are unavailable.
        </p>
      ) : winners.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          No comparable past winner. This seat was created or redrawn at a
          boundary review, so earlier results cover a different area.
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* `w-px` on the year and margin cells pins each to its own content;
              the width a wide viewport adds then goes to the candidate column,
              rather than being shared out with a four-digit year. The margin
              lines stay on one line, because a wrapped label would make that
              column's own width unpredictable. */}
          <table className={cn('w-full', TABLE_TEXT_COMPACT)}>
            <tbody>
              {winners.map((w) => (
                <tr key={`${w.year}-${w.electorateName}`} className={TR_ROW}>
                  <td className="w-px whitespace-nowrap px-3 py-2 font-label text-xs font-semibold tabular-nums text-muted-foreground sm:px-4 sm:py-3 sm:text-sm">
                    {w.year}
                  </td>
                  <td className="px-3 py-2 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-1.5">
                      <PartyDot color={partyColor(w.party)} size="md" />
                      <span className="text-sm font-semibold sm:text-base">
                        {w.candidate}
                      </span>
                    </div>
                    <div className="text-[0.8125rem] text-muted-foreground sm:text-sm">
                      {w.party ?? 'Independent'}
                      {w.priorElectorateName
                        ? ` · as ${w.priorElectorateName}`
                        : ''}
                    </div>
                  </td>
                  <td className="w-px px-3 py-2 text-right sm:px-4 sm:py-3">
                    <div className="flex items-baseline justify-end gap-x-1.5 whitespace-nowrap">
                      <span className="font-mono font-bold tabular-nums">
                        {w.majority.toLocaleString()}
                      </span>
                      <span className={MARGIN_LABEL}>vote margin</span>
                    </div>
                    <div className="flex items-baseline justify-end gap-x-1.5 whitespace-nowrap">
                      <span className="font-mono text-xs tabular-nums sm:text-sm">
                        {(w.majorityPercent * 100).toFixed(1)}%
                      </span>
                      <span className={MARGIN_LABEL}>of votes cast</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
