import { ElectorateCountBand } from './ElectorateCountBand.js';
import { ElectorateResultsTable } from './ElectorateResultsTable.js';
import { PastWinners } from './PastWinners.js';
import VoteHistoryChart from './VoteHistoryChart.js';
import { Toggle } from './Toggle.js';
import type { PollsCloseState } from '../hooks/usePollsClose.js';
import type { ElectorateResult } from '@election-night/core/types';
import type {
  ElectorateHistoryPoint,
  PriorWinner,
} from '../lib/history-types.js';
import type { SeatChance } from '@election-night/core/seat-probability';

/** The two contests the table can show; the seat is won on the first. */
const VIEW_OPTIONS: { value: 'candidate' | 'party'; label: string }[] = [
  { value: 'candidate', label: 'Candidate' },
  { value: 'party', label: 'Party' },
];

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
  pollsClose,
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
  /** Polls-close state, for the panel's before-counting copy. */
  pollsClose?: PollsCloseState | null;
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
        <Toggle
          options={VIEW_OPTIONS}
          value={showPartyVote ? 'party' : 'candidate'}
          onChange={(view) => onTogglePartyVote(view === 'party')}
        />
      </div>

      {/* One panel, one ordering. The band above the table is the count's own
          state — votes in, the gap, votes out — and the table is the count
          itself with the projection as a column, so a reader can see the two
          facts disagree on one line instead of reconciling two panels. */}
      <div className="border overflow-hidden">
        {!showPartyVote && (
          <ElectorateCountBand
            result={result}
            chance={chance}
            updatedAt={updatedAt}
            pollsClose={pollsClose}
          />
        )}

        <ElectorateResultsTable
          result={result}
          showPartyVote={showPartyVote}
          chance={chance}
        />
      </div>

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
