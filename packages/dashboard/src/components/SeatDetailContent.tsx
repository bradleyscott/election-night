import { Link } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import type { SeatInfo } from '../lib/parliament.js';

/**
 * What the seat's count can support, in one line.
 *
 * A live count gives a chance; a finished one gives a margin. Those are
 * different kinds of statement and the popover never prints one as the other —
 * which is why a complete seat shows its margin here rather than "100%".
 */
function chanceLine(info: SeatInfo): string | null {
  const chance = info.chance;
  if (!chance || chance.state === 'waiting') return null;
  if (chance.state === 'complete') return null;
  return `${Math.round(chance.probability * 100)}%`;
}

export function SeatDetailContent({ info, onClose }: { info: SeatInfo; onClose: () => void }) {
  const chance = chanceLine(info);

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
          aria-label="Close details"
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
            <span className="chip-print">Electorate</span>
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
            </div>
          </div>
        )}

        {chance !== null && (
          <div>
            <div className="text-muted-foreground">Chance</div>
            <div className="font-semibold tabular-nums">{chance}</div>
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
