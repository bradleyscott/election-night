import { partyColor } from '../lib/constants.js';
import { formatUpdatedAgo } from '../lib/seat-chance.js';
import { formatVotes } from '../lib/chart-format.js';
import type { ElectorateResult } from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';
import {
  formatPollsCountdown,
  type PollsClosePhase,
} from '@election-night/core/polls-close';
import type { PollsCloseState } from '../hooks/usePollsClose.js';
import { PartyDot } from './PartyDot.js';

type CandidateRow = {
  name: string;
  party: string | null;
  votes: number;
};

const partyColour = (party: string | null | undefined) => partyColor(party);

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
 * The electorate verdict: a chance of winning while the count is live, a
 * margin once it is not, and nothing before the first votes arrive.
 *
 * Deliberately absent: a percentage that means "safe", a margin of error, and
 * a total vote count. The first two are the model this replaces; the total is
 * not knowable mid-count, so printing one would be a guess dressed as a fact.
 *
 * While the count is live the card answers one question — who is likely to win
 * — and then shows why in one strip: how much of tonight's vote is in, and how
 * much is still out. Those are the same fact told from both ends, so they are
 * drawn together instead of split between a header chip and a footnote.
 */
export function ElectorateStats({
  result,
  showPartyVote,
  chance,
  updatedAt,
  pollsClose,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
  /** The computed chance, from `seatChanceFor`. Absent renders the count only. */
  chance?: SeatChance | null;
  /** When this browser's results last changed, printed quietly in the header. */
  updatedAt?: Date | null;
  /**
   * The cycle's polls-close state, for the before-counting copy. Absent (or
   * `stale`/`unknown`) when the server cannot say when this cycle closes.
   */
  pollsClose?: PollsCloseState | null;
}) {
  // The party view has no verdict to give: a seat's chance of winning is a
  // candidate-vote fact, and the party vote decides a different contest. Rather
  // than relabel the card, or print a party number that would teach the same
  // percentage two meanings, the card is simply not there.
  if (showPartyVote) return null;

  if (!chance || chance.state === 'waiting') {
    const chip = closeChip(pollsClose);
    return (
      <div className="border panel-print p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="kicker">Win %</div>
          {chip && <span className="chip-print">{chip}</span>}
        </div>
        <div className="mt-3 font-display text-2xl font-bold tracking-tight">
          No votes counted yet
        </div>
        <p className="mt-1 font-label text-xs text-muted-foreground">
          {waitingNote(pollsClose?.phase)}
        </p>
      </div>
    );
  }

  if (chance.state === 'complete') {
    return (
      <CompleteVerdict result={result} chance={chance} updatedAt={updatedAt} />
    );
  }

  const candidates: CandidateRow[] = [chance.leader, chance.runnerUp].map(
    (c) => ({ name: c.name, party: c.party ?? null, votes: c.votes })
  );
  // Ordered by chance, not by votes. A seat 39% counted can have the trailing
  // candidate favoured, because the votes still to come are expected to favour
  // them; listing the count leader first reads as a contradiction when the two
  // numbers disagree. The count's own state stays on whichever row leads it.
  const rows = [
    { candidate: candidates[0], share: chance.probability, leadsCount: true },
    {
      candidate: candidates[1],
      share: runnerUpProbability(chance),
      leadsCount: false,
    },
  ].sort((a, b) => b.share - a.share);
  const updated = formatUpdatedAgo(updatedAt ?? null);

  return (
    <div className="border panel-print p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="kicker">Win %</div>
        {updated && (
          <span className="font-label text-[11px] text-muted-foreground">
            Updated {updated}
          </span>
        )}
      </div>

      <div className="mt-1 divide-y divide-border">
        {rows.map((row) => (
          <ChanceRow
            key={row.candidate.name}
            candidate={row.candidate}
            share={row.share}
            label="chance of winning"
            margin={row.leadsCount ? chance.margin : undefined}
            marginPercent={
              row.leadsCount
                ? result.votesCounted
                  ? chance.margin / result.votesCounted
                  : null
                : undefined
            }
          />
        ))}
      </div>

      <CountStrip
        counted={result.votesCounted}
        progress={chance.progress}
        remaining={chance.remainingVotes}
      />
    </div>
  );
}

/**
 * One bar, two states: the solid share has been counted, the hatched share has
 * not. Both strips draw it the same way, because "counted / still to come" is
 * the same shape whether the missing votes are tonight's or the specials'.
 */
function SplitBar({ share }: { share: number }) {
  const clamped = Math.max(0, Math.min(1, share));

  return (
    <div className="mt-2 flex h-2 w-full" aria-hidden="true">
      <div
        className="bg-foreground/70"
        style={{ width: `${clamped * 100}%` }}
      />
      <div className="hatch-outstanding flex-1" />
    </div>
  );
}

/**
 * The votes in and the votes out, drawn as one bar: the solid share has been
 * counted, the hatched share is still to come. The percentage and the vote
 * counts sit either end so the reader can see both without reading the bar.
 */
function CountStrip({
  counted,
  progress,
  remaining,
}: {
  counted: number;
  progress: number;
  remaining: number;
}) {
  const share = Math.max(0, Math.min(1, progress));

  return (
    <div className="mt-1 border-t pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="kicker">Counted</div>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            <span className="text-sm font-bold text-foreground">
              {Math.round(share * 100)}%
            </span>
            {' \u00b7 '}
            {formatVotes(counted)} votes
          </div>
        </div>
        <div className="text-right">
          <div className="kicker">Still out</div>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            about {formatVotes(remaining)} votes
          </div>
        </div>
      </div>
      <SplitBar share={share} />
    </div>
  );
}

/**
 * The strip the complete card wears instead. Nothing is still out tonight — the
 * count has stopped — but the specials are, and they arrive in the same slot
 * the outstanding votes just left, so the reader does not have to learn a
 * second vocabulary at the moment the card stops moving.
 */
function SpecialsStrip({
  counted,
  specials,
}: {
  counted: number;
  specials: number;
}) {
  const total = counted + specials;
  const share = total > 0 ? counted / total : 1;

  return (
    <div className="mt-1 border-t pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="kicker">Counted</div>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            <span className="text-sm font-bold text-foreground">
              {formatVotes(counted)}
            </span>{' '}
            votes
          </div>
        </div>
        <div className="text-right">
          <div className="kicker">Specials to come</div>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            about {formatVotes(specials)} votes
          </div>
        </div>
      </div>
      <SplitBar share={share} />
      <div className="mt-1 font-label text-[11px] text-muted-foreground">
        {Math.round(share * 100)}% of the expected final vote
      </div>
    </div>
  );
}

/**
 * The runner-up's chance is the leader's complement: two candidates, one seat.
 * A third candidate above a couple of percent is not given a number that would
 * have to compete for the same 100.
 */
function runnerUpProbability(
  chance: Extract<SeatChance, { state: 'counting' }>
) {
  return Math.max(0, 1 - chance.probability);
}

function ChanceRow({
  candidate,
  share,
  label,
  margin,
  marginPercent,
  marginUnit,
  shareDecimals = 0,
  showEvenTick = true,
}: {
  candidate: CandidateRow;
  share: number;
  label: string;
  /** Votes between the top two, shown on the leading row only. */
  margin?: number;
  /** That gap as a share of the votes counted, as the rest of the app defines it. */
  marginPercent?: number | null;
  /** What the margin's percentage is a share of: "of votes" once the count stops. */
  marginUnit?: string;
  /** 1 keeps the tenths a completed count prints; a chance would round them away. */
  shareDecimals?: number;
  /** Half votes is not the line a finished count is judged against. */
  showEvenTick?: boolean;
}) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <PartyDot color={partyColour(candidate.party)} size="md" />
            <span className="font-label text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {candidate.party ?? 'Independent'}
            </span>
          </div>
          <div className="mt-1 font-display text-lg font-bold leading-tight tracking-tight">
            {candidate.name}
          </div>
          <div className="font-label text-xs tabular-nums text-muted-foreground">
            {formatVotes(candidate.votes)} votes
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div
            className="font-display text-4xl font-bold leading-none tracking-tight tabular-nums"
            title={label}
          >
            {(share * 100).toFixed(shareDecimals)}
            <span className="text-xl">%</span>
          </div>
        </div>
      </div>
      {/* The track runs the full hundred so the fill is a share of it, and the
          hairline at the halfway mark says where even sits — at 45% the fill
          stops short of it, at 55% it passes it. */}
      <div className="relative mt-2 h-2 w-full bg-foreground/15">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${Math.max(0, Math.min(100, share * 100))}%`,
            backgroundColor: partyColour(candidate.party),
          }}
        />
        {showEvenTick && (
          <div
            aria-hidden="true"
            className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/40"
          />
        )}
      </div>
      {margin !== undefined && (
        <div className="kicker mt-1.5">
          {margin === 0
            ? 'Level'
            : `Ahead by ${formatVotes(margin)}${
                marginPercent != null
                  ? ` (${(marginPercent * 100).toFixed(1)}%${
                      marginUnit ? ` ${marginUnit}` : ''
                    })`
                  : ''
              }`}
        </div>
      )}
    </div>
  );
}

/**
 * A finished count has a margin, not a probability — a probability that could
 * only read 100% tells the reader nothing. So the number stops, and the card
 * hands the space to the two facts that outlive the night: the margin as a
 * share of the votes counted, and the specials still to come, which in 2023
 * were 21% of all votes and did move seats. The rows are the counting card's
 * own, so the eye does not have to relearn the panel when the count stops.
 */
function CompleteVerdict({
  result,
  chance,
  updatedAt,
}: {
  result: ElectorateResult;
  chance: Extract<SeatChance, { state: 'complete' }>;
  updatedAt?: Date | null;
}) {
  const total = result.votesCounted || 1;
  const updated = formatUpdatedAgo(updatedAt ?? null);
  const rows: CandidateRow[] = [chance.leader, chance.runnerUp].map((c) => ({
    name: c.name,
    party: c.party ?? null,
    votes: c.votes,
  }));

  return (
    <div className="border panel-print p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="kicker">Count complete</div>
        {updated && (
          <span className="font-label text-[11px] text-muted-foreground">
            Updated {updated}
          </span>
        )}
      </div>

      <div className="mt-1 divide-y divide-border">
        {rows.map((candidate, index) => (
          <ChanceRow
            key={candidate.name}
            candidate={candidate}
            share={candidate.votes / total}
            shareDecimals={1}
            label="share of votes counted"
            showEvenTick={false}
            margin={index === 0 ? chance.margin : undefined}
            marginPercent={index === 0 ? chance.margin / total : undefined}
            marginUnit="of votes"
          />
        ))}
      </div>

      <SpecialsStrip
        counted={result.votesCounted}
        specials={chance.specialsOutstanding}
      />
    </div>
  );
}
