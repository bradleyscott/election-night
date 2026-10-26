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

  return (
    <div className="border panel-print p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="kicker">Chance of winning</div>
        {countChip && (
          <span className="chip-print chip-print--ink">{countChip}</span>
        )}
      </div>

      <div className="mt-2 divide-y divide-border">
        <ChanceRow
          candidate={candidates[0]}
          share={chance.probability}
          label="chance of winning"
          margin={chance.margin}
          marginPercent={
            result.votesCounted ? chance.margin / result.votesCounted : null
          }
        />
        <ChanceRow
          candidate={candidates[1]}
          share={runnerUpProbability(chance)}
          label="chance of winning"
        />
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
  const third = sorted[2];
  const total = result.votesCounted || 1;
  const leaderParty = chance.leader.party ?? 'Independent';
  const thirdShare = third ? third.votes / total : 0;
  const shownShare = top.reduce((sum, c) => sum + c.votes / total, 0);
  const othersShare = Math.max(
    0,
    1 - shownShare - (thirdShare >= 0.05 ? thirdShare : 0)
  );

  return (
    <div className="border panel-print p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="kicker">Tonight&rsquo;s count complete</div>
        <span className="chip-print chip-print--red">
          {leaderParty} ahead by {chance.margin.toLocaleString()}
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

      <div className="mt-4 flex h-2.5 border border-border">
        {top.map((candidate) => (
          <div
            key={candidate.candidate}
            style={{
              width: `${(candidate.votes / total) * 100}%`,
              backgroundColor: partyColour(candidate.party),
            }}
          />
        ))}
        {thirdShare >= 0.05 && third && (
          <div
            style={{
              width: `${thirdShare * 100}%`,
              backgroundColor: partyColour(third.party),
            }}
          />
        )}
        <div
          style={{
            width: `${othersShare * 100}%`,
            backgroundColor: 'hsl(var(--muted-foreground) / 0.45)',
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 font-label text-xs text-muted-foreground">
        <span>Share of votes counted</span>
        <span>
          Special votes are counted after election night and can still change
          this seat.
        </span>
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
