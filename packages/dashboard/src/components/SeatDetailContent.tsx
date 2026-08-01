import { Link } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import type { SeatInfo } from '../lib/parliament.js';

export function SeatDetailContent({
  info,
  onClose,
}: {
  info: SeatInfo;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{
              backgroundColor: info.color,
              opacity: info.opacity,
            }}
          />
          <span className="font-bold truncate text-sm">{info.party}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs leading-none p-0.5"
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          {info.type === 'list' && (
            <span className="chip-print chip-print--red">List</span>
          )}
          {info.type === 'electorate' && (
            <span
              className={cn(
                'chip-print',
                info.predictionStatus === 'projected' &&
                  'border-green-700/40 bg-green-700/10 text-green-800 dark:bg-green-500/15 dark:text-green-300',
                info.predictionStatus === 'likely' &&
                  'border-green-700/40 bg-green-700/10 text-green-800 dark:bg-green-500/15 dark:text-green-300',
                info.predictionStatus === 'leaning' &&
                  'border-orange-600/40 bg-orange-600/10 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
                info.predictionStatus === 'too-close' &&
                  'border-amber-600/40 bg-amber-600/10 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
                !info.predictionStatus &&
                  'border-amber-600/40 bg-amber-600/10 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
              )}
            >
              {(info.predictionStatus === 'projected' ||
                info.predictionStatus === 'likely') &&
                'Likely winner'}
              {info.predictionStatus === 'leaning' && 'Leaning'}
              {info.predictionStatus === 'too-close' && 'Too close to call'}
              {!info.predictionStatus && 'Too close to call'}
            </span>
          )}
        </div>

        {info.type === 'electorate' && info.name && (
          <div>
            <div className="text-muted-foreground">Electorate</div>
            <Link
              to={`/electorates/${encodeURIComponent(info.name)}`}
              className="font-semibold text-primary hover:underline"
              onClick={onClose}
            >
              {info.name}
            </Link>
          </div>
        )}

        {info.type === 'electorate' && info.candidate && (
          <div>
            <div className="text-muted-foreground">Candidate</div>
            <div className="font-semibold">{info.candidate}</div>
          </div>
        )}

        {info.type === 'electorate' && info.margin !== undefined && (
          <div>
            <div className="text-muted-foreground">Margin</div>
            <div className="font-semibold tabular-nums">
              {info.margin.toLocaleString()} votes
            </div>
          </div>
        )}

        {info.type === 'electorate' && info.marginPercent !== undefined && (
          <div>
            <div className="text-muted-foreground">Lead</div>
            <div className="font-semibold tabular-nums">
              {(info.marginPercent * 100).toFixed(1)}%
              {info.marginOfError !== undefined && (
                <span className="text-muted-foreground font-normal">
                  {' '}
                  ±{(info.marginOfError * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        )}

        {info.type === 'list' && info.candidate && (
          <>
            <div>
              <div className="text-muted-foreground">Candidate</div>
              <div className="font-semibold">{info.candidate}</div>
            </div>
            {info.listRank !== undefined && (
              <div>
                <div className="text-muted-foreground">List Rank</div>
                <div className="font-semibold tabular-nums">
                  #{info.listRank}
                </div>
              </div>
            )}
            {info.adjustedRank !== undefined && (
              <div>
                <div className="text-muted-foreground">Adjusted Rank</div>
                <div className="font-semibold tabular-nums">
                  #{info.adjustedRank}
                </div>
              </div>
            )}
            {info.distanceFromCut !== undefined && (
              <div>
                <div className="text-muted-foreground">From Cut</div>
                <div
                  className={cn(
                    'font-semibold tabular-nums',
                    info.distanceFromCut >= 0
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-muted-foreground'
                  )}
                >
                  {info.distanceFromCut >= 0 ? '+' : ''}
                  {Math.round(info.distanceFromCut)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
