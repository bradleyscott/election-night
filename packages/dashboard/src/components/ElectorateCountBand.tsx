import { cn } from '../lib/utils.js';
import { formatEstimate, formatVotes } from '../lib/chart-format.js';
import { formatUpdatedAgo } from '../lib/seat-chance.js';
import {
  formatPollsCountdown,
  type PollsClosePhase,
} from '@election-night/core/polls-close';
import type { ElectorateResult } from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';
import { summarizeCount } from '@election-night/core/count-summary';
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
  contributingPlaces,
  inSeatBooths,
  electionYear,
}: {
  result: ElectorateResult;
  /**
   * The seat's model result. Absent or `waiting` no longer means "no votes":
   * the band shows the counted facts it has and labels the estimate unknown.
   */
  chance?: SeatChance | null;
  /**
   * When this browser's results last changed, printed at the top of the panel
   * where the eye lands.
   */
  updatedAt?: Date | null;
  /**
   * The cycle's polls-close state, for the before-counting copy. Absent (or
   * `stale`/`unknown`) when the server cannot say when this cycle closes.
   */
  pollsClose?: PollsCloseState | null;
  /**
   * The contributing place set, which counts towards this seat and may include
   * advance hubs standing elsewhere. Not the same as the in-seat booths.
   */
  contributingPlaces?: { counted: number; total: number } | null;
  /** Booths standing inside this electorate, as the map draws them. */
  inSeatBooths?: { counted: number; total: number } | null;
  /** Cycle, for the summary's turnout and special-vote constants. */
  electionYear?: string | number | null;
}) {
  const summary = summarizeCount({
    result,
    chance,
    electionYear: electionYear == null ? null : Number(String(electionYear)),
    enrolment: chance?.state === 'counting' ? chance.enrolment : null,
    contributingPlaces,
    inSeatBooths,
  });

  const counted = summary.ordinary.counted;
  const complete = summary.ordinary.state === 'complete';
  const hasVotes = counted > 0;

  if (!hasVotes && (!chance || chance.state === 'waiting')) {
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

  const margin =
    chance && 'margin' in chance
      ? chance.margin
      : (result.candidateVotes[0]?.votes ?? 0) -
        (result.candidateVotes[1]?.votes ?? 0);
  const marginShare = counted > 0 ? margin / counted : null;
  const updated = formatUpdatedAgo(updatedAt ?? null);

  const places = summary.places;
  const placesText =
    places.contributingReported != null && places.contributingTotal != null
      ? `${places.contributingReported} / ${places.contributingTotal}`
      : places.contributingFraction != null
        ? `${(places.contributingFraction * 100).toFixed(1)}%`
        : 'not reported';
  const boothsText =
    places.inSeatBoothsReported != null && places.inSeatBoothsTotal != null
      ? `${places.inSeatBoothsReported} / ${places.inSeatBoothsTotal} booths in this electorate`
      : null;

  const progress = summary.ordinary.progress;
  const percent = progress == null ? null : Math.round(progress * 100);
  const ordinaryEstimate = summary.ordinary.remaining;
  const specialsEstimate = summary.specials.remaining;
  const specialsShare =
    specialsEstimate && counted + specialsEstimate.value > 0
      ? specialsEstimate.value / (counted + specialsEstimate.value)
      : 0;

  return (
    <div className="border-b">
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Stat label="Voting places reported">
          <span className="text-sm font-bold text-foreground">
            {placesText}
          </span>
          {boothsText && <div className="mt-0.5">{boothsText}</div>}
        </Stat>
        <Stat label="Counted" className="border-l">
          {!complete && percent != null && (
            <>
              <span className="text-sm font-bold text-foreground">
                {percent}%
              </span>
              {' · '}
            </>
          )}
          {formatVotes(counted)} votes
        </Stat>
        <Stat label="Margin" className="border-t sm:border-l sm:border-t-0">
          <span className="text-sm font-bold text-foreground">
            {formatVotes(margin)}
          </span>
          {marginShare != null && ` (${(marginShare * 100).toFixed(1)}%)`}
        </Stat>
        <Stat
          label={
            complete
              ? 'Ordinary count'
              : 'Estimated ordinary votes remaining tonight'
          }
          className="border-l border-t sm:border-t-0"
        >
          {complete
            ? 'Complete'
            : ordinaryEstimate
              ? `about ${formatEstimate(ordinaryEstimate.value)} votes`
              : 'Estimate unavailable'}
        </Stat>
      </div>

      <div className="px-3 pb-2.5 sm:px-4">
        <SplitBar share={progress ?? 0} />
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
          <div className="font-label text-[11px] text-muted-foreground">
            {complete
              ? 'Election-night count complete'
              : progress != null
                ? 'Estimated ordinary count'
                : 'Ordinary progress unavailable'}
          </div>
          {updated && (
            <span className="ml-auto font-label text-[11px] text-muted-foreground">
              Updated {updated}
            </span>
          )}
        </div>

        {/* The specials are a different measure with a different denominator:
            they are added after the night and are not part of ordinary
            progress. Keeping them on their own labelled bar means the ordinary
            bar never changes meaning at completion. */}
        <div className="mt-2 border-t pt-2">
          <div className="kicker">Estimated specials to be counted later</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex h-1.5 flex-1 border" aria-hidden="true">
              <div
                className="bg-foreground/30"
                style={{
                  width: `${Math.max(0, Math.min(1, specialsShare)) * 100}%`,
                }}
              />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {specialsEstimate
                ? `about ${formatEstimate(specialsEstimate.value)} votes`
                : 'Not reported'}
            </span>
          </div>
          <p className="mt-1 font-label text-[10px] text-muted-foreground">
            Counted after election night, separate from the ordinary count.
          </p>
        </div>
      </div>
    </div>
  );
}
