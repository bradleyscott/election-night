import { partyColors } from '../lib/constants.js';
import { formatUpdatedAgo } from '../lib/seat-chance.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import type { SeatChance } from '@election-night/core/seat-probability';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

type CandidateRow = {
  name: string;
  party: string | null;
  votes: number;
};

const partyColour = (party: string | null | undefined) =>
  (party && partyColors[party]) || '#666';

const percent = (fraction: number) => (fraction * 100).toFixed(1);

/**
 * The electorate verdict: a chance of winning while the count is live, a
 * margin once it is not, and nothing before the first votes arrive.
 *
 * Deliberately absent: a percentage that means "safe", a margin of error, and
 * a total vote count. The first two are the model this replaces; the total is
 * not knowable mid-count, so printing one would be a guess dressed as a fact.
 */
export function ElectorateStats({
  result,
  showPartyVote,
  chance,
  updatedAt,
  pollsCloseLabel,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
  /** The computed chance, from `seatChanceFor`. Absent renders the count only. */
  chance?: SeatChance | null;
  /** When this browser's results last changed, for the count chip. */
  updatedAt?: Date | null;
  /** "7pm" — shown before the first result, when the cycle's close is known. */
  pollsCloseLabel?: string | null;
}) {
  const countChip = countChipText(chance, updatedAt);

  // The party view has no verdict to give: a seat's chance of winning is a
  // candidate-vote fact, and the party vote decides a different contest. Rather
  // than relabel the card, or print a party number that would teach the same
  // percentage two meanings, the card is simply not there.
  if (showPartyVote) return null;


  if (!chance || chance.state === 'waiting') {
    return (
      <div className="border panel-print p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="kicker">Chance of winning</div>
          {pollsCloseLabel && (
            <span className="chip-print">Polls close {pollsCloseLabel}</span>
          )}
        </div>
        <div className="mt-3 font-display text-2xl font-bold tracking-tight">
          No votes counted yet
        </div>
        <p className="mt-1 font-label text-xs text-muted-foreground">
          First results usually follow within about half an hour.
        </p>
      </div>
    );
  }

  if (chance.state === 'complete') {
    return <CompleteVerdict result={result} chance={chance} />;
  }

  const candidates: CandidateRow[] = [chance.leader, chance.runnerUp].map(
    (c) => ({ name: c.name, party: c.party ?? null, votes: c.votes })
  );
  const others = chance.othersProbability;
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

  return (
    <div className="border panel-print p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="kicker">Chance of winning</div>
        {countChip && (
          <span className="chip-print chip-print--ink">{countChip}</span>
        )}
      </div>

      <div className="mt-2 divide-y divide-border">
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
      {others >= 0.005 && (
        <div className="pt-2 font-label text-xs text-muted-foreground">
          All others {Math.round(others * 100)}%
        </div>
      )}

      {chance.provisionalPrior && (
        <p className="mt-1 font-label text-xs text-muted-foreground">
          This seat has no comparable result from last time, so the number rests
          on tonight&rsquo;s count alone.
        </p>
      )}
    </div>
  );
}

/**
 * The runner-up's chance is the leader's complement: two candidates, one seat.
 * A third candidate above a couple of percent is left in "All others" rather
 * than given a number that would have to compete for the same 100.
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
}: {
  candidate: CandidateRow;
  share: number;
  label: string;
  /** Votes between the top two, shown on the leading row only. */
  margin?: number;
  /** That gap as a share of the votes counted, as the rest of the app defines it. */
  marginPercent?: number | null;
}) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 ring-1 ring-foreground/20"
              style={{ backgroundColor: partyColour(candidate.party) }}
            />
            <span className="font-label text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {candidate.party ?? 'Independent'}
            </span>
          </div>
          <div className="mt-1 font-display text-lg font-bold leading-tight tracking-tight">
            {candidate.name}
          </div>
          <div className="font-label text-xs tabular-nums text-muted-foreground">
            {candidate.votes.toLocaleString()} votes
            {margin !== undefined && (
              <>
                {' \u00b7 '}
                {margin === 0
                  ? 'level'
                  : `ahead by ${margin.toLocaleString()}${
                      marginPercent != null
                        ? ` (${(marginPercent * 100).toFixed(1)}%)`
                        : ''
                    }`}
              </>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div
            className="font-display text-4xl font-bold leading-none tracking-tight tabular-nums"
            title={label}
          >
            {Math.round(share * 100)}
            <span className="text-xl">%</span>
          </div>
        </div>
      </div>
      <div className="mt-2 h-2 w-full bg-secondary">
        <div
          className="h-full"
          style={{
            width: `${Math.max(0, Math.min(100, share * 100))}%`,
            backgroundColor: partyColour(candidate.party),
          }}
        />
      </div>
    </div>
  );
}

function CompleteVerdict({
  result,
  chance,
}: {
  result: ElectorateResult;
  chance: Extract<SeatChance, { state: 'complete' }>;
}) {
  const sorted = [...result.candidateVotes].sort((a, b) => b.votes - a.votes);
  const top = sorted.slice(0, 2);
  const total = result.votesCounted || 1;
  // The badge names the person, not the party: the count on this panel is the
  // candidate vote, and which person won is the fact the night produces.
  const leaderName = chance.leader.name;

  return (
    <div className="border panel-print p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="kicker">Tonight&rsquo;s count complete</div>
        <span className="chip-print chip-print--red">
          <span className="normal-case">{leaderName}</span> ahead by{' '}
          {chance.margin.toLocaleString()} ({percent(chance.margin / total)}%)
        </span>
      </div>

      <div className="mt-4 divide-y divide-border border-y border-border">
        {top.map((candidate, index) => (
          <div
            key={candidate.candidate}
            className="flex items-baseline justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 ring-1 ring-foreground/20"
                  style={{ backgroundColor: partyColour(candidate.party) }}
                />
                <span className="font-label text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {candidate.party ?? 'Independent'}
                </span>
              </div>
              <div
                className={`mt-1 font-display text-lg leading-tight tracking-tight ${
                  index === 0 ? 'font-bold' : 'font-semibold'
                }`}
              >
                {candidate.candidate}
              </div>
            </div>
            <div className="flex-shrink-0 text-right tabular-nums">
              <div className="font-display text-3xl font-bold leading-none tracking-tight">
                {candidate.votes.toLocaleString()}
              </div>
              <div className="mt-1 font-mono text-xs font-semibold text-muted-foreground">
                {percent(candidate.votes / total)}% of votes
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

function countChipText(
  chance: SeatChance | null | undefined,
  updatedAt: Date | null | undefined
): string | null {
  if (!chance || chance.state !== 'counting') {
    if (chance?.state === 'complete') {
      const ago = formatUpdatedAgo(updatedAt ?? null);
      return ago ? `Updated ${ago}` : null;
    }
    return null;
  }
  const counted = `${Math.round(chance.progress * 100)}% counted`;
  const ago = formatUpdatedAgo(updatedAt ?? null);
  return ago ? `${counted} · updated ${ago}` : counted;
}
