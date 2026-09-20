import { ElectorateStats } from './ElectorateStats.js';
import { ElectorateResultsTable } from './ElectorateResultsTable.js';
import { PastWinners } from './PastWinners.js';
import VoteHistoryChart from './VoteHistoryChart.js';
import { cn } from '../lib/utils.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  VotingResults,
} from '@election-night/core/types';
import type {
  ElectorateHistoryPoint,
  PriorWinner,
} from '../lib/history-types.js';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

export function ElectorateDetail({
  result,
  showPartyVote,
  onTogglePartyVote,
  historyData,
  priorWinners,
  priorUnavailable,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
  onTogglePartyVote: (showPartyVote: boolean) => void;
  historyData: ElectorateHistoryPoint[] | null;
  /** This seat's prior-cycle winners, newest first; empty when none apply. */
  priorWinners?: PriorWinner[];
  priorUnavailable?: boolean;
}) {
  const leadingPartyVote = [...result.partyVotes].sort(
    (a, b) => b.votes - a.votes
  )[0] as VotingResults | undefined;

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
        leadingPartyVote={leadingPartyVote ?? null}
      />

      <ElectorateResultsTable result={result} showPartyVote={showPartyVote} />

      {priorWinners !== undefined && (
        <PastWinners
          winners={priorWinners}
          unavailable={priorUnavailable ?? false}
          currentLeaderParty={result.leaders.leadingCandidateParty}
        />
      )}

      {historyData && historyData.length > 1 && (
        <VoteHistoryChart
          history={historyData}
          mode="votes"
          showParty={showPartyVote}
        />
      )}
    </div>
  );
}
