import type { ReactNode } from 'react';
import { partyColors } from '../lib/constants.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  VotingResults,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

export function ElectorateStats({
  result,
  showPartyVote,
  leadingPartyVote,
}: {
  result: ElectorateResult;
  showPartyVote: boolean;
  leadingPartyVote: VotingResults | null;
}) {
  if (showPartyVote) {
    return (
      <>
        <div className="border p-3 sm:p-4">
          <div className="kicker mb-1">Leading party</div>
          <div>
            <div className="font-display font-bold text-xl sm:text-2xl tracking-tight">
              {leadingPartyVote?.candidate ?? 'Unknown'}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div
                className="w-2.5 h-2.5 flex-shrink-0 ring-1 ring-foreground/20"
                style={{
                  backgroundColor:
                    partyColors[leadingPartyVote?.candidate ?? ''] || '#666',
                }}
              />
              <span className="text-xs sm:text-sm text-muted-foreground">
                {leadingPartyVote
                  ? `${leadingPartyVote.votes.toLocaleString()} votes`
                  : ''}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <StatCard label="Votes Counted">
            <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
              {result.votesCounted.toLocaleString()}
            </span>
            <span className="ml-1 text-xs sm:text-sm text-muted-foreground/60 font-medium">
              of{' '}
              {Math.round(
                result.votesCounted / result.votePercentageCounted
              ).toLocaleString()}{' '}
              total
            </span>
          </StatCard>
          <StatCard label="% Counted">
            <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
              {(result.votePercentageCounted * 100).toFixed(1)}%
            </span>
          </StatCard>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="Leading candidate">
          <div className="text-xl sm:text-2xl font-display font-bold tracking-tight">
            {result.leaders.leadingCandidate}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div
              className="w-2.5 h-2.5 flex-shrink-0 ring-1 ring-foreground/20"
              style={{
                backgroundColor:
                  partyColors[result.leaders.leadingCandidateParty ?? ''] || '#666',
              }}
            />
            <span className="text-xs sm:text-sm text-muted-foreground">
              {result.leaders.leadingCandidateParty ?? 'Unknown'}
            </span>
          </div>
        </StatCard>
        <StatusCard status={result.leaders.predictionStatus} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="Margin">
          <span className="font-display font-bold text-xl sm:text-2xl tracking-tight">
            {result.leaders.margin.toLocaleString()}
          </span>
        </StatCard>
        <StatCard label="Lead">
          <span className="font-display font-bold text-xl sm:text-2xl tracking-tight">
            {(result.leaders.marginPercent * 100).toFixed(1)}%
            <span className="text-base sm:text-lg font-semibold text-muted-foreground ml-1 font-mono">
              ± {(result.marginOfError * 100).toFixed(1)}%
            </span>
          </span>
        </StatCard>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="Votes Counted">
          <span className="font-display font-bold text-xl sm:text-2xl tracking-tight">
            {result.votesCounted.toLocaleString()}
          </span>
          <span className="ml-1 text-xs sm:text-sm text-muted-foreground/60 font-label">
            of{' '}
            {Math.round(
              result.votesCounted / result.votePercentageCounted
            ).toLocaleString()}{' '}
            total
          </span>
        </StatCard>
        <StatCard label="% Counted">
          <span className="font-display font-bold text-xl sm:text-2xl tracking-tight">
            {(result.votePercentageCounted * 100).toFixed(1)}%
          </span>
        </StatCard>
      </div>
    </>
  );
}

function StatCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border p-3 sm:p-4">
      <div className="kicker mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function StatusCard({ status }: { status: string | null | undefined }) {
  const statusClass =
    status === 'projected'
      ? 'text-green-700 dark:text-green-400'
      : status === 'likely'
      ? 'text-green-700 dark:text-green-400'
      : status === 'leaning'
      ? 'text-orange-700 dark:text-orange-400'
      : 'text-amber-700 dark:text-amber-400';

  const statusText =
    status === 'projected' || status === 'likely'
      ? 'Likely winner'
      : status === 'leaning'
      ? 'Leaning'
      : status === 'too-close'
      ? 'Too close to call'
      : 'Too close to call';

  return (
    <div className="border p-3 sm:p-4">
      <div className="kicker mb-1">Status</div>
      <div>
        <span
          className={`font-display font-bold text-xl sm:text-2xl tracking-tight ${statusClass}`}
        >
          {statusText}
        </span>
      </div>
    </div>
  );
}
