import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import { WaitingState } from './WaitingState.js';

/**
 * The page's masthead rule and title — the one place `pagehead` is written.
 *
 * Every page head was the same four lines of JSX, so the rule (a two-pixel
 * foreground line), the h1 sizing and the baseline alignment lived in twelve
 * copies. `children` takes the extra masthead items a page puts beside the
 * title (Flipped's kicker), and `className` carries the one real variant,
 * `mb-0`, for a head inside a flex row.
 */
export function PageHead({
  title,
  children,
  className,
}: {
  title: ReactNode;
  /** Extra masthead items beside the title, e.g. a kicker or a count. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('pagehead', className)}>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

type WaitingProps = Omit<
  ComponentProps<typeof WaitingState>,
  'className' | 'title'
>;

/**
 * The empty state every data page shares: the head, then the tally animation,
 * inside the reveal wrapper. `waitingTitle` overrides the waiting state's own
 * copy where the page can say something more specific.
 */
export function PageWaiting({
  title,
  waitingTitle,
  ...waiting
}: { title: string; waitingTitle?: string } & WaitingProps) {
  return (
    <div className="animate-fade-in">
      <PageHead title={title} />
      <WaitingState {...waiting} title={waitingTitle} />
    </div>
  );
}
