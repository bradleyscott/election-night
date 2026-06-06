import { type ReactNode } from 'react';
import { cn } from '../lib/utils.js';

const dotVariants = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  yellow: 'bg-yellow-500 ring-yellow-500/20 shadow-[0_0_6px_2px_rgba(234,179,8,0.3)]',
} as const;

export type TimelineDotColor = keyof typeof dotVariants;

export function TimelineItem({
  dotColor = 'blue',
  isLast = false,
  children,
  className,
}: {
  dotColor?: TimelineDotColor;
  isLast?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-3', className)}>
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'w-2.5 h-2.5 rounded-full ring-[3px] ring-background shrink-0 mt-[5px]',
            dotVariants[dotColor]
          )}
        />
        {!isLast && <div className="w-0.5 flex-1 bg-border/80" />}
      </div>
      <div className="pb-3 flex-1 min-w-0 pl-5">{children}</div>
    </div>
  );
}

export function TimelineGroupHeader({ label, time }: { label: string; time?: string }) {
  return (
    <div className="flex gap-3 pb-1">
      <div className="w-2.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
          {label}
        </span>
        {time && (
          <span className="text-[11px] text-muted-foreground/50 ml-2 tabular-nums">
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

export function TimelineSeparator({ label, time }: { label: string; time?: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-px flex-1 bg-border/30" />
      </div>
      <div className="pb-1 flex-1 min-w-0">
        <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
          {label}
        </span>
        {time && (
          <span className="text-[11px] text-muted-foreground/50 ml-2 tabular-nums">
            {time}
          </span>
        )}
      </div>
    </div>
  );
}
