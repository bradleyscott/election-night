import { useResults } from '../hooks/useResults.js';
import { cn } from '../lib/utils.js';

export default function LiveIndicator() {
  const { results, connected } = useResults();
  const isLive = connected && results !== null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-label font-bold uppercase tracking-[0.09em] text-[10px]',
        isLive ? 'text-brand' : 'text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          isLive ? 'bg-brand animate-pulse-live' : 'bg-muted-foreground'
        )}
        aria-hidden="true"
      />
      {isLive ? 'Live' : 'Disconnected'}
    </span>
  );
}
