import { cn } from '../lib/utils.js';
import { formatVotes } from '../lib/chart-format.js';
import { formatUpdatedAgo } from '../lib/seat-chance.js';
import {
  formatPollsCountdown,
  type PollsClosePhase,
} from '@election-night/core/polls-close';
import type { ElectorateResult } from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';
import type { PollsCloseState } from '../hooks/usePollsClose.js';

/**
 * The header chip before this seat has counted: a live countdown while the
 * polls are open, the same "counting" phrase the masthead uses once they shut.
 *
 * Nothing is shown for a cycle with no known close instant (`stale` when an
 * archived cycle is replayed, `unknown` when the server did not say), because
 * a countdown to another election's date is worse than no countdown.
 */
function closeChip(
  pollsClose: PollsCloseState | null | undefined
): string | null {
  if (pollsClose?.phase === 'upcoming' && pollsClose.countdown) {
    return `Polls close in ${formatPollsCountdown(pollsClose.countdown)}`;
  }
  if (pollsClose?.phase === 'counting') return 'Polls closed · counting';
  return null;
}

/**
 * What happens, and when, before this seat has counted.
 *
 * The old copy — "first results usually follow within about half an hour" —
 * named no anchor, so before the close it read as half an hour from *now*.
 * Each phase now says its own half of one fact: counting starts at the close,
 * and preliminary results are published progressively from 7pm
 * (electionresults.govt.nz).
 */
function waitingNote(phase: PollsClosePhase | undefined): string {
  if (phase === 'upcoming') {
    return 'Counting starts when voting closes. Preliminary results are published progressively from then.';
  }
  if (phase === 'counting') {
    return 'Preliminary results are published progressively from 7pm.';
  }
  return 'Results appear here as counting gets underway.';
}

/**
 * One bar, two states: the solid share has been counted, the hatched share has
 * not. Both bands draw it the same way, because "counted / still to come" is
 * the same shape whether the missing votes are tonight's or the specials'.
 */
function SplitBar({ share }: { share: number }) {
  const clamped = Math.max(0, Math.min(1, share));

  return (
    <div className="flex h-2 w-full" aria-hidden="true">
      <div
        className="bg-foreground/70"
        style={{ width: `${clamped * 100}%` }}
      />
      <div className="hatch-outstanding flex-1" />
    </div>
  );
}

/** One labelled figure in the band. Mono numerals, so the columns line up. */
function Stat({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-3 py-2.5', className)}>
      <div className="kicker">{label}</div>
      <div className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/**
 * The count's own state, at the top of the seat panel: how much of tonight's
 * vote is in, the gap between the top two, and how much is still out.
 *
 * This replaces the "win %" card. That card carried the chance at the top of
 * the page and a vote count beside each candidate, so the same names and the
 * same numbers appeared twice — once ordered by chance, once ordered by votes
 * — and a reader had to work out which panel was the forecast. In the hard case
 * the two orders faced opposite ways. The chance now has a column of its own in
 * the table below it, and this band carries only facts that come from the
 * count, so nothing here can disagree with anything under it.
 *
 * Deliberately absent: any probability. There is one chance on the page and it
 * is in the table, beside the votes it disagrees with — which is the whole
 * explanation of why it can disagree.
 */
export function ElectorateCountBand({
  result,
  chance,
  updatedAt,
  pollsClose,
}: {
  result: ElectorateResult;
  /**
   * The seat's chance, for the count's denominators. Absent or `waiting` shows
   * the ballot list's own header instead of a strip of zeros.
   */
  chance?: SeatChance | null;
  /**
   * When this browser's results last changed, printed at the top of the panel
   * where the eye lands — the count is the thing being refreshed, so the time
   * it last moved belongs above the figures rather than in a footnote.
   */
  updatedAt?: Date | null;
  /**
   * The cycle's polls-close state, for the before-counting copy. Absent (or
   * `stale`/`unknown`) when the server cannot say when this cycle closes.
   */
  pollsClose?: PollsCloseState | null;
}) {
  if (!chance || chance.state === 'waiting') {
    const chip = closeChip(pollsClose);
    return (
      <div className="border-b px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="kicker">Counted</div>
          {chip && <span className="chip-print">{chip}</span>}
        </div>
        <div className="mt-1 font-display text-lg font-bold tracking-tight">
          No votes counted yet
        </div>
        <p className="mt-0.5 font-label text-xs text-muted-foreground">
          {waitingNote(pollsClose?.phase)}
        </p>
      </div>
    );
  }

  // A finished count is not a result: the specials are counted over the
  // fortnight after the night, so the slot the outstanding votes just left is
  // handed to them rather than closed. The reader does not have to learn a
  // second vocabulary at the moment the band stops moving.
  const complete = chance.state === 'complete';
  const counted = result.votesCounted;
  const outstanding = complete
    ? chance.specialsOutstanding
    : chance.remainingVotes;
  const finalTotal = counted + outstanding;
  // While counting, progress is votes counted over the night's estimated total
  // (`nightRemaining`) — the same number the Trends tape plots. Once the count
  // is complete the denominator is the whole vote, specials included, because
  // that is now the only thing outstanding.
  const share = complete
    ? finalTotal > 0
      ? counted / finalTotal
      : 1
    : chance.progress;
  const percent = Math.round(share * 100);
  const marginShare = counted > 0 ? chance.margin / counted : null;
  const updated = formatUpdatedAgo(updatedAt ?? null);

  return (
    <div className="border-b">
      <div className="grid grid-cols-2 sm:grid-cols-3">
        {/* While the night is running the percentage is the progress — the
            number that makes the chance legible. Once the count is complete it
            is a share of the final vote, which the line under the bar states
            once; printing it here as well would put the same 84% on the panel
            twice. */}
        <Stat label="Counted">
          {!complete && (
            <>
              <span className="text-sm font-bold text-foreground">
                {percent}%
              </span>
              {' · '}
            </>
          )}
          {formatVotes(counted)} votes
        </Stat>
        <Stat label="Margin" className="border-l">
          <span className="text-sm font-bold text-foreground">
            {formatVotes(chance.margin)}
          </span>
          {marginShare != null && ` (${(marginShare * 100).toFixed(1)}%)`}
        </Stat>
        <Stat
          label={complete ? 'Specials to come' : 'Still out'}
          className="col-span-2 border-t sm:col-span-1 sm:border-l sm:border-t-0"
        >
          about {formatVotes(outstanding)} votes
        </Stat>
      </div>

      <div className="px-3 pb-2.5 sm:px-4">
        <SplitBar share={share} />
        {/* Directly under the bar and above the table: the count is the thing
            being refreshed, so the time it last moved sits at the foot of the
            figures rather than in a caption under the last row. */}
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
          {complete ? (
            <div className="font-label text-[11px] text-muted-foreground">
              Count complete · {percent}% of the expected final vote
            </div>
          ) : (
            <span />
          )}
          {updated && (
            <span className="ml-auto font-label text-[11px] text-muted-foreground">
              Updated {updated}
            </span>
          )}
        </div>
        {/* Worth calling out only when the specials are large enough that the
            margin is inside them. No direction is claimed: the model prices the
            swing, it does not predict its sign. */}
        {complete && chance.insideSpecials && (
          <div className="font-label text-[11px] text-foreground">
            The margin is inside the special vote.
          </div>
        )}
      </div>
    </div>
  );
}
