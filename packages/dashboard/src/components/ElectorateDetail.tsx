import { ElectorateCountBand } from './ElectorateCountBand.js';
import { ElectorateResultsTable } from './ElectorateResultsTable.js';
import { PastWinners } from './PastWinners.js';
import VoteHistoryChart from './VoteHistoryChart.js';
import type { PollsCloseState } from '../hooks/usePollsClose.js';
import type { ElectorateResult } from '@election-night/core/types';
import type {
  ElectorateHistoryPoint,
  PriorWinner,
} from '../lib/history-types.js';
import type { SeatChance } from '@election-night/core/seat-probability';

export function ElectorateDetail({
  result,
  showPartyVote,
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
  historyData: ElectorateHistoryPoint[] | null;
  /** The seat's voting places, for the receipt rug on the count chart. */
  votingPlaces?: { counted: number; total: number; receipts: number[] };
  /** This seat's prior-cycle winners, newest first; empty when none apply. */
  priorWinners?: PriorWinner[];
  priorUnavailable?: boolean;
  /** Chance of winning, computed by the page from the cycle's baseline. */
  chance?: SeatChance | null;
  /** When this seat's count last changed (the feed's own stamp for the seat). */
  updatedAt?: Date | null;
  /** Polls-close state, for the panel's before-counting copy. */
  pollsClose?: PollsCloseState | null;
}) {
  return (
    <div
      className="space-y-3 sm:space-y-4 opacity-0 animate-fade-in-up"
      style={{ animationDelay: '0.2s' }}
    >
      {/* One panel, one ordering. The band above the table is the count's own
          state — votes in, the gap, votes out — and the table is the count
          itself with the projection as a column, so a reader can see the two
          facts disagree on one line instead of reconciling two panels. The
          seat's name and its Candidate/Party switch live in the page head, so
          the panel starts with the count rather than repeating the title. */}
      {/* `overflow-clip` rather than `overflow-hidden`: the seat's count table
          carries a sticky head, which would be positioned against this panel if
          it were a scroll container. The panel still clips its band's hairlines
          to the border. */}
      <div className="border overflow-clip">
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
