import type { ThHTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

/**
 * The header typography every table shares: the small, spaced, muted label.
 *
 * Padding, alignment and width stay at the call site — the wide tables pad
 * `px-3 py-2 sm:py-3` while the compact ones pad `px-2` and no vertical — but
 * the six classes that make a header look like a header were written out at
 * twenty-eight `<th>`s before this existed.
 */
export const TH_CLASS =
  'font-label font-semibold uppercase tracking-wide text-xs text-muted-foreground';

/**
 * A header cell for the tables that use the standard box. `align` and every
 * other `<th>` attribute pass through, so a sortable header keeps its handler
 * and its cursor affordances in `className`.
 */
export function Th({
  align = 'left',
  className,
  children,
  ...rest
}: { align?: 'left' | 'right' } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        TH_CLASS,
        'px-3 py-2 sm:py-3',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
      {...rest}
    >
      {children}
    </th>
  );
}
