import { cn } from '../lib/utils.js';

/**
 * A party's colour as a printed key: a hairline-ringed square the size of a
 * text line, used anywhere a party is named in a table, chip or legend.
 *
 * The swatch existed in about twenty places with three different sizes and
 * three ring opacities, which is how a design token drifts. One size for dense
 * rows (`sm`, 8px) and one where the row has room (`md`, 10px), one hairline.
 * The colour arrives already resolved — `partyColor(party)` — because a chart
 * legend sometimes has a colour that is not a party's (a candidate's line).
 *
 * `aria-hidden`: the swatch repeats the party's name beside it, so it is
 * decoration, not information.
 */
export function PartyDot({
  color,
  size = 'sm',
  className,
}: {
  /** The resolved colour, e.g. `partyColor(party)`. */
  color: string;
  /** `sm` is 8px (dense tables, chips); `md` is 10px. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block flex-shrink-0 ring-1 ring-foreground/20',
        size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5',
        className
      )}
      style={{ backgroundColor: color }}
    />
  );
}
