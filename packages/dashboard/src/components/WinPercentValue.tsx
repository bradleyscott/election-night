import type { ReactNode } from 'react';
import type { SeatChance } from '@election-night/core/seat-probability';

/**
 * The one way the app prints a seat's chance of being held.
 *
 * Before this, the same number was set four ways: Playfair in the seat panel,
 * body bold on Close Calls, and mono regular on Flipped and Candidates. The
 * model was the same in all four; only the clothes were not.
 *
 * `table` is the table-scale treatment (mono, semibold, tabular figures).
 * `feature` is the seat panel's larger display number, which is the one place a
 * chance is a headline rather than a cell. A seat with no number yet prints the
 * caller's `fallback`, so a waiting seat and a candidate the model does not
 * price can say different things without a second component.
 */

/** The chance a priced seat carries, or null while it is still waiting. */
export function chancePercent(chance?: SeatChance | null): number | null {
  if (chance?.state === 'counting' || chance?.state === 'complete') {
    return chance.probability;
  }
  return null;
}

const COMPLETE_TITLE =
  'The ordinary count is complete; this is the chance of holding the seat once the special votes are added';

/** The tooltip a chance carries, including the finished-count distinction. */
export function winPercentTitle(
  chance?: SeatChance | null
): string | undefined {
  return chance?.state === 'complete' ? COMPLETE_TITLE : undefined;
}

export function WinPercentValue({
  percent,
  variant = 'table',
  title,
  fallback,
}: {
  /** A 0..1 share, or null/undefined when there is no number to print. */
  percent: number | null | undefined;
  variant?: 'table' | 'feature';
  title?: string;
  fallback?: ReactNode;
}) {
  if (percent === null || percent === undefined) {
    return <>{fallback ?? <span className="text-muted-foreground">—</span>}</>;
  }

  const rounded = Math.round(percent * 100);
  const label = title ?? `${rounded}% chance of winning the seat`;

  if (variant === 'feature') {
    return (
      <div
        className="font-display text-base font-bold leading-none tabular-nums sm:text-lg"
        title={label}
      >
        {rounded}
        <span className="text-xs">%</span>
      </div>
    );
  }

  return (
    <span className="font-mono font-semibold tabular-nums" title={label}>
      {rounded}%
    </span>
  );
}
