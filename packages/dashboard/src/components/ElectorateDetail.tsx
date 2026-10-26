import { ElectorateStats } from './ElectorateStats.js';
import { ElectorateResultsTable } from './ElectorateResultsTable.js';
import { PastWinners } from './PastWinners.js';
import VoteHistoryChart from './VoteHistoryChart.js';
import { cn } from '../lib/utils.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import type {
  ElectorateHistoryPoint,
  PriorWinner,
} from '../lib/history-types.js';
import type { SeatChance } from '@election-night/core/seat-probability';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

export function ElectorateDetail({
  result,
  showPartyVote,
  onTogglePartyVote,
  historyData,
  votingPlaces,
  priorWinners,
  priorUnavailable,
  chance,
  updatedAt,
  pollsCloseLabel,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
  onTogglePartyVote: (showPartyVote: boolean) => void;
  historyData: ElectorateHistoryPoint[] | null;
  /** The seat's voting places, for the receipt rug on the count chart. */
  votingPlaces?: { counted: number; total: number; receipts: number[] };
  /** This seat's prior-cycle winners, newest first; empty when none apply. */
  priorWinners?: PriorWinner[];
  priorUnavailable?: boolean;
  /** Chance of winning, computed by the page from the cycle's baseline. */
  chance?: SeatChance | null;
  /** When this browser's results last changed. */
  updatedAt?: Date | null;
  /** Polls-close label for the before-counting state, e.g. "7pm". */
  pollsCloseLabel?: string | null;
}) {
  return (
    <div
      className="space-y-3 sm:space-y-4 opacity-0 animate-fade-in-up"
      style={{ animationDelay: '0.2s' }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight">
          {result.electorateName}
        </h2>
        <div className="flex border overflow-hidden font-label text-sm font-semibold flex-shrink-0">
          <button
            className={cn(
              'px-3 py-1.5 transition-colors border-r border-border last:border-r-0',
              !showPartyVote
                ? 'bg-foreground text-background'
                : 'bg-background text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onTogglePartyVote(false)}
          >
            Candidate
          </button>
          <button
            className={cn(
              'px-3 py-1.5 transition-colors border-r border-border last:border-r-0',
              showPartyVote
                ? 'bg-foreground text-background'
                : 'bg-background text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onTogglePartyVote(true)}
          >
            Party
          </button>
        </div>
      </div>

      <ElectorateStats
        result={result}
        showPartyVote={showPartyVote}
        chance={chance}
        updatedAt={updatedAt}
        pollsCloseLabel={pollsCloseLabel}
      />

      <ElectorateResultsTable result={result} showPartyVote={showPartyVote} />

      {/* Prior winners are who won the seat, and a seat is won on the
          candidate vote. In party view the table below is the party vote, so
          the two are not about the same contest and would read as a claim that
          the party must repeat what its candidate did. */}
      {!showPartyVote && priorWinners !== undefined && (
        <PastWinners
          winners={priorWinners}
          unavailable={priorUnavailable ?? false}
        />
      )}

      {historyData && historyData.length > 1 && (
        <VoteHistoryChart
          history={historyData}
          mode="votes"
          showParty={showPartyVote}
          votingPlaces={votingPlaces}
        />
      )}
    </div>
  );
}
