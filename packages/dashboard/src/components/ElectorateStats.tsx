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
        <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
          <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
            Leading party
          </div>
          <div className="mt-0.5">
            <div className="text-xl sm:text-2xl font-extrabold tracking-tight">
              {leadingPartyVote?.candidate ?? 'Unknown'}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/20"
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
          <div className="text-xl sm:text-2xl font-extrabold tracking-tight">
            {result.leaders.leadingCandidate}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/20"
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
          <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
            {result.leaders.margin.toLocaleString()}
          </span>
        </StatCard>
        <StatCard label="Lead">
          <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
            {(result.leaders.marginPercent * 100).toFixed(1)}%
            <span className="text-base sm:text-lg font-bold text-muted-foreground ml-1">
              ± {(result.marginOfError * 100).toFixed(1)}%
            </span>
          </span>
        </StatCard>
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

function StatCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
      <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function StatusCard({ status }: { status: string | null | undefined }) {
  const statusClass =
    status === 'projected'
      ? 'text-green-500'
      : status === 'likely'
      ? 'text-lime-500'
      : status === 'leaning'
      ? 'text-orange-500'
      : 'text-amber-500';

  const statusText =
    status === 'projected' || status === 'likely'
      ? 'Likely winner'
      : status === 'leaning'
      ? 'Leaning'
      : status === 'too-close'
      ? 'Too close to call'
      : 'Too close to call';

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4 shadow-sm">
      <div className="text-xs sm:text-sm text-muted-foreground font-bold uppercase tracking-wide">
        Status
      </div>
      <div className="mt-0.5">
        <span
          className={`text-xl sm:text-2xl font-extrabold tracking-tight ${statusClass}`}
        >
          {statusText}
        </span>
      </div>
    </div>
  );
}
