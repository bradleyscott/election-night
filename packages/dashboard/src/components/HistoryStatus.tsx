import type { HistoryLoadState } from '../lib/history-api.js';
import { cn } from '../lib/utils.js';

/**
 * An honest note beside a history surface: the rows may still be on screen,
 * but they are not current, or there are none to show and the request failed.
 *
 * The HTTP message is only a hover title; the reader gets the state, and a
 * retry that does the same request again.
 */
export function HistoryStatus({
  state,
  error,
  onRetry,
  className,
}: {
  state: HistoryLoadState;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  if (state !== 'stale' && state !== 'error' && state !== 'unavailable') {
    return null;
  }

  const message =
    state === 'stale'
      ? 'Showing the last history we could verify.'
      : state === 'unavailable'
        ? 'History is unavailable right now.'
        : 'History could not be refreshed.';

  return (
    <div
      role="status"
      title={error ?? undefined}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm',
        className
      )}
    >
      <span className="text-muted-foreground">{message}</span>
      {onRetry && (
        <button type="button" className="chip-print" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
