import { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils.js';

type WaitingVariant = 'full' | 'compact' | 'inline';

const MESSAGES: Record<string, string> = {
  default:     'Results will appear here as counting gets underway.',
  electorates: 'Electorate results will stream in as booths across New Zealand report.',
  closecalls:  'The tightest races will surface here as counting gets underway.',
  feed:        'Events will appear here as results start coming in across the country.',
  parties:     'Party list standings will update as votes are tallied nationwide.',
  parliament:  "Parliament's composition will take shape as votes are counted.",
  candidates:  'Likely parliamentarians will be listed here once results begin arriving.',
  sidebar:     'Updates will appear as results come in.',
};

type WaitingContext = keyof typeof MESSAGES;

interface WaitingStateProps {
  variant?: WaitingVariant;
  context?: WaitingContext;
  className?: string;
}

const STROKE_DELAY = 380;
const HOLD = 1100;
const FADE = 500;
const RESET_PAUSE = 250;

function useCountingAnimation() {
  const [drawnCount, setDrawnCount] = useState(0);
  const [fading, setFading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function run(n: number) {
      if (n < 5) {
        timer.current = setTimeout(() => {
          setDrawnCount(n + 1);
          run(n + 1);
        }, STROKE_DELAY);
      } else {
        timer.current = setTimeout(() => {
          setFading(true);
          timer.current = setTimeout(() => {
            setFading(false);
            setDrawnCount(0);
            timer.current = setTimeout(() => run(0), RESET_PAUSE);
          }, FADE);
        }, HOLD);
      }
    }
    run(0);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  return { drawnCount, fading };
}

function TallyGroup({
  x,
  y,
  strokeWidth,
  drawnCount,
  fading,
  muted,
}: {
  x: number;
  y: number;
  strokeWidth: number;
  drawnCount?: number;
  fading?: boolean;
  muted?: boolean;
}) {
  const sp = 13;
  const h = 52;

  // 4 vertical lines + 1 diagonal slash crossing through them all
  const strokes: [number, number, number, number][] = [
    [x,          y,      x,              y + h],
    [x + sp,     y,      x + sp,         y + h],
    [x + sp * 2, y,      x + sp * 2,     y + h],
    [x + sp * 3, y,      x + sp * 3,     y + h],
    [x - 5,      y + h + 5, x + sp * 3 + 5, y - 5],
  ];

  return (
    <>
      {strokes.map(([x1, y1, x2, y2], i) => {
        const active = drawnCount !== undefined;
        const shown = active ? (!fading && drawnCount > i) : true;
        const opacity = muted ? 0.25 : shown ? 1 : 0;

        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="hsl(var(--primary))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{
              opacity,
              transition: active
                ? fading
                  ? `opacity ${FADE}ms ease-out`
                  : 'opacity 0.18s ease-out'
                : undefined,
            }}
          />
        );
      })}
    </>
  );
}

function TallyVisualization({ size }: { size: 'lg' | 'sm' }) {
  const { drawnCount, fading } = useCountingAnimation();
  const sw = size === 'lg' ? 2.8 : 2.2;

  if (size === 'lg') {
    // 3 groups: 2 completed (muted) + 1 actively counting
    return (
      <svg width="185" height="72" viewBox="0 0 185 72" fill="none" aria-hidden="true">
        <TallyGroup x={10}  y={10} strokeWidth={sw} muted />
        <TallyGroup x={72}  y={10} strokeWidth={sw} muted />
        <TallyGroup x={134} y={10} strokeWidth={sw} drawnCount={drawnCount} fading={fading} />
      </svg>
    );
  }

  // 2 groups: 1 completed (muted) + 1 actively counting
  return (
    <svg width="120" height="65" viewBox="0 0 120 65" fill="none" aria-hidden="true">
      <TallyGroup x={10} y={7} strokeWidth={sw} muted />
      <TallyGroup x={68} y={7} strokeWidth={sw} drawnCount={drawnCount} fading={fading} />
    </svg>
  );
}

export function WaitingState({
  variant = 'full',
  context = 'default',
  className,
}: WaitingStateProps) {
  const message = MESSAGES[context] ?? MESSAGES.default;

  if (variant === 'inline') {
    return (
      <div className={cn('flex flex-col items-center gap-2.5 py-5', className)}>
        <div className="flex items-end gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-full bg-primary"
              style={{
                width: 5,
                height: 5,
                animation: `waitDot 1.4s ease-in-out ${i * 0.28}s infinite`,
              }}
            />
          ))}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
          Awaiting results
        </p>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center text-center py-8 gap-5',
          className
        )}
      >
        <TallyVisualization size="sm" />
        <div className="space-y-1.5 max-w-[220px]">
          <p
            className="text-[10px] font-black tracking-[0.3em] uppercase"
            style={{ color: 'hsl(var(--primary))' }}
          >
            Awaiting Data
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'py-16 sm:py-24 animate-fade-in',
        className
      )}
    >
      <TallyVisualization size="lg" />

      <div className="mt-10 space-y-3 max-w-[300px]">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-none">
          Awaiting First Results
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>

        <div className="flex items-center justify-center gap-2 pt-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-full bg-primary/50"
              style={{
                width: 6,
                height: 6,
                animation: `waitDot 1.4s ease-in-out ${i * 0.28}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
