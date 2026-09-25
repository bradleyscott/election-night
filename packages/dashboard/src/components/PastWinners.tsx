import { partyColors } from '../lib/constants.js';
import type { PriorWinner } from '../lib/history-types.js';

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
          <table className="w-full text-sm">
            <tbody>
              {winners.map((w) => (
                <tr
                  key={`${w.year}-${w.electorateName}`}
                  className="border-b last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-label text-xs font-semibold tabular-nums text-muted-foreground sm:px-4">
                    {w.year}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-2.5 w-2.5 flex-shrink-0 ring-1 ring-foreground/20"
                        style={{
                          backgroundColor: partyColors[w.party ?? ''] || '#666',
                        }}
                      />
                      <span className="font-semibold">{w.candidate}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {w.party ?? 'Unknown'}
                      {w.priorElectorateName
                        ? ` · as ${w.priorElectorateName}`
                        : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums sm:px-4">
                    <span className="font-bold">
                      {w.majority.toLocaleString()}
                    </span>{' '}
                    <span className="text-xs text-muted-foreground">
                      vote margin
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {(w.majorityPercent * 100).toFixed(1)}% of votes cast
                    </span>
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
