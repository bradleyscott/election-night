import { useResults } from '../hooks/useResults.js';
import { cn } from '../lib/utils.js';

export default function LiveIndicator() {
  const { results, connected } = useResults();
  const isLive = connected && results !== null;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          'relative inline-flex h-4 w-4 rounded-full',
          isLive && 'animate-pulse-live'
        )}
      >
        <span
          className={cn(
            'absolute inset-0 rounded-full',
            isLive
              ? 'bg-green-500 animate-ping opacity-30'
              : 'bg-red-500'
          )}
        />
        <span
          className={cn(
            'relative inline-flex rounded-full h-4 w-4',
            isLive
              ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]'
              : 'bg-red-500'
          )}
        />
      </span>
      <span className="hidden sm:inline text-sm text-white/70 font-semibold">
        {isLive ? 'Live' : 'Disconnected'}
      </span>
    </div>
  );
}
