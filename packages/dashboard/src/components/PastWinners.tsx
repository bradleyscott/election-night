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
 */
export function PastWinners({
  winners,
  unavailable,
  currentLeaderParty,
}: {
  /** This electorate's prior winners, newest cycle first. Empty when none. */
  winners: PriorWinner[];
  /** The collector could not derive any prior cycle. */
  unavailable: boolean;
  currentLeaderParty: string | undefined;
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
          Prior election results are unavailable — previous cycles could not be
          fetched.
        </p>
      ) : winners.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          No comparable prior holder: this seat was created or redrawn since the
          last comparable election.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {winners.map((w) => {
                const flipped =
                  (w.party ?? null) !== (currentLeaderParty ?? null);
                return (
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
                            backgroundColor:
                              partyColors[w.party ?? ''] || '#666',
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
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {(w.majorityPercent * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right sm:px-4">
                      {flipped && (
                        <span className="chip-print chip-print--red">
                          Flipped
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground sm:px-4">
            Majority is the winner&apos;s lead over the runner-up. Only cycles
            where this electorate continued under the same area are shown.
          </p>
        </div>
      )}
    </div>
  );
}
