import { useResults } from '../hooks/useResults.js';
import { countProgress } from '../lib/seat-chance.js';
import { hasCounted } from '../lib/results.js';
import { useSeatChances } from '../hooks/useSeatChances.js';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber.js';
import { cn } from '../lib/utils.js';
import ParliamentSeats from '../components/ParliamentSeats.js';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';
import { PageHead, PageWaiting } from '../components/Page.js';

function AnimatedStat({
  label,
  value,
  format,
  delay,
}: {
  label: string;
  value: number | null;
  format?: (v: number) => string;
  delay: number;
}) {
  const animated = useAnimatedNumber(value ?? 0);

  return (
    <div
      className={cn(
        'p-2.5 sm:p-3 opacity-0 animate-fade-in-up',
        `stagger-${delay}`
      )}
    >
      <div className="kicker mb-1">{label}</div>
      <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight">
        {value !== null
          ? format
            ? format(animated)
            : Math.round(animated).toLocaleString()
          : '—'}
      </div>
    </div>
  );
}

export default function Seats() {
  const { results } = useResults();

  const partyVote = results?.partyVote;
  const sorted = partyVote
    ? [...partyVote].sort((a, b) => b.seats - a.seats)
    : [];
  const totalSeats = sorted.reduce((s, p) => s + p.seats, 0);
  const partiesInParliament = sorted.filter((p) => p.seats > 0).length;

  const electorateResults = results?.electorateResults ?? [];
  // The chance of winning each seat, computed once for the whole page so the
  // parliament grid and the seat page's number all come from the same call.
  const { electionYear, chances } = useSeatChances(electorateResults);

  // Counted votes and how far through the night that is. The denominator is
  // the votes these seats are expected to receive tonight, floored by the share
  // of each seat's voting places that have actually reported — places do not
  // hold equal numbers of votes, and advance votes land in blocks after 7pm, so
  // the place share is a floor on what is still out rather than a progress bar.
  const progress = countProgress(electorateResults, electionYear);
  const overallVotePercentage =
    progress.fraction !== null ? progress.fraction * 100 : null;

  // The page is entirely derived from the count, so the zeroed ballot the feed
  // publishes before election day has nothing here to report: the stat grid
  // would read 0 / 0 / 0 / — and the Parliament block its own compact waiting
  // line, two different ways of saying the same thing on one page. Until a vote
  // is counted the page shows the count's own pending state, the same one the
  // Feed and Trends pages show. See `lib/results.ts`.
  if (!hasCounted(results)) {
    return <PageWaiting title="Seats" context="default" />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHead title="Seats" />

      <div className="grid grid-cols-2 lg:grid-cols-4 stat-grid">
        <AnimatedStat label="Total Seats" value={totalSeats} delay={1} />
        <AnimatedStat
          label="Parties in Parliament"
          value={partiesInParliament}
          delay={2}
        />
        <div
          className={cn('p-2.5 sm:p-3 opacity-0 animate-fade-in-up stagger-3')}
        >
          <div className="kicker mb-1">Votes counted</div>
          <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight tabular-nums">
            {progress.votesCounted.toLocaleString()}
          </div>
        </div>
        <div
          className={cn('p-2.5 sm:p-3 opacity-0 animate-fade-in-up stagger-4')}
        >
          <div className="kicker mb-1">Counted</div>
          <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight">
            {overallVotePercentage !== null
              ? overallVotePercentage.toFixed(1) + '%'
              : '—'}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'border border-border p-4 sm:p-6 opacity-0 animate-fade-in-up stagger-5'
        )}
      >
        <ParliamentSeats
          partyVote={partyVote ?? []}
          electorateResults={results?.electorateResults ?? []}
          partyLists={
            (results?.partyLists ?? []) as (PartyList & WithAdjustedRank)[]
          }
          chances={chances}
        />
      </div>
    </div>
  );
}
