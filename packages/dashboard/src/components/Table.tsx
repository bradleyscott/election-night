import type { ThHTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

/**
 * The header typography every table shares: the small, spaced, muted label.
 *
 * Set at `text-sm` (14px) to sit a step under the 1rem body: a 12px header
 * over 16px rows read as a caption rather than a heading. It stays smaller
 * than the data and tracked, which is what makes it a label. Below `sm` it
 * drops one pixel to 13px, because on a phone a tracked header such as
 * `Win chance` is what pushes a column into wrapping and the table into a
 * sideways scroll.
 *
 * Padding, alignment and width stay at the call site — the wide tables pad
 * `px-3 py-2 sm:py-3` while the compact ones pad `px-2` and no vertical — but
 * the six classes that make a header look like a header were written out at
 * twenty-eight `<th>`s before this existed.
 */
export const TH_CLASS =
  'font-label font-semibold uppercase tracking-wide text-[0.8125rem] text-muted-foreground sm:text-sm';

/**
 * Cell type: the table's step above body copy, one pixel smaller on a phone.
 *
 * `sm` and up keep the 1rem the design system specifies. Below `sm`, 16px
 * makes a four-column result table wrap names and scroll sideways on a 390px
 * screen, so the type drops to 15px — still larger than the 0.875rem second
 * line, and the difference between one line and two in a name column.
 */
export const TABLE_TEXT = 'text-[0.9375rem] sm:text-base';

/**
 * The Parliament table is set a size larger on purpose; it takes the same one
 * pixel cut on a phone, so its rows stay level with every other table there.
 */
export const TABLE_TEXT_LG = 'text-[0.9375rem] sm:text-lg';

/**
 * The compact table inside the open seat's panel, which already ran a step
 * under the rest on a phone so five columns could fit. It makes the same one
 * pixel cut, and its header meets its cells at 13px below `sm` — uppercase and
 * tracked, so it still reads as the label rather than as data.
 */
export const TABLE_TEXT_COMPACT = 'text-[0.8125rem] sm:text-base';

/**
 * The row shell every data table shares: hairline rule under each row, no rule
 * under the last, and a transition so a hover tint does not snap.
 *
 * The tint is `/30` everywhere. Close Calls and the party list had drifted to
 * `/20`, which made the same table feel like a different component.
 */
export const TR_ROW = 'border-b border-border last:border-0 transition-colors';

/** The hover tint on a row that does something when clicked. */
export const TR_ROW_HOVER = 'hover:bg-muted/30';

/** A whole row that navigates: pointer plus the app's standard focus ring. */
export const TR_CLICKABLE =
  'cursor-pointer focus:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring/25';

/**
 * Figures in a table are mono with tabular figures, per the design system; the
 * rule used to hold only on Flipped and Candidates.
 */
export const NUMERIC = 'font-mono tabular-nums';

/** A numeric cell's alignment, on top of the table's own padding. */
export const NUMERIC_CELL = 'text-right whitespace-nowrap';

/**
 * The frame around a table. Tables that sit inside a panel (Parliament on
 * Seats, the results table in the electorate panel) already have the panel's
 * border and must not add a second one; every flush table wears this.
 */
export const TABLE_FRAME = 'border border-border';

/**
 * The first column, frozen below `sm` while the table scrolls sideways to a
 * column the phone cannot show beside it. The paper ground stops the cells
 * passing underneath from showing through, and the hairline is where they go
 * under. Both are reset at `sm`, where nothing scrolls and a rule there would
 * be a line through a table that has no reason for one.
 *
 * The bottom border repeats the row's rule on the cell itself. A row carrying a
 * CSS transform (the reveal animation's `translateY`, retained by
 * `animation-fill-mode: forwards`) becomes its own stacking context, and the
 * pinned cell's opaque `bg-background` then paints over the row's border where
 * the two overlap — so the first column lost its separator while every other
 * column kept one. A cell's own border paints over its own background, so the
 * rule survives whichever stacking context the row creates. The last body row
 * drops it, matching `TR_ROW`'s `last:border-0`, so the frame's bottom edge
 * stays a single hairline.
 */
export const PINNED =
  'sticky left-0 z-10 border-r border-b border-border bg-background [tbody_tr:last-child_&]:border-b-0 sm:border-r-0';

const PINNED_EDGE =
  "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-6 after:translate-x-full after:bg-gradient-to-r after:from-background after:to-transparent after:content-[''] sm:after:hidden";

/**
 * The same column once the table has actually moved: a soft shadow on its right
 * edge, and a fade bleeding 24px over the cells sliding under it — without the
 * fade the passing cell reads as text with its first letters cut off rather
 * than as something travelling underneath.
 */
export const PINNED_MOVED = `shadow-[8px_0_8px_-8px_hsl(var(--foreground)/0.35)] ${PINNED_EDGE}`;

/**
 * The scroller every data table sits in — applied only while the table is
 * actually wider than its frame, because being a scroller is load-bearing.
 *
 * `overflow-x: auto` makes a box a scroll container on *both* axes: CSS Overflow
 * says an axis set to `visible` or `clip` next to a scrolling axis computes to
 * `auto` and `hidden`, so `overflow-y-clip` does not leave the vertical axis to
 * the page — the computed value is `hidden`, and the frame is the sticky head's
 * scrollport. That scrollport is content-sized and never scrolls, so `top` on a
 * head cell is pure displacement: it pushed every head down by the masthead's
 * height and painted it over the first one or two rows (58px on a phone, 96px
 * at `sm`). Hence `--table-sticky-offset: 0` here: inside a scroller the head
 * stays in flow instead of covering the table.
 *
 * A table that fits puts no scroller around itself at all (nothing to scroll
 * with) and keeps `top: var(--masthead-height)`, which is the only state in
 * which a sticky head can park under the masthead while the page scrolls.
 * `useHorizontalOverflow` measures which of the two applies; never write
 * `overflow-x-auto` on a table frame by hand.
 */
export const TABLE_SCROLL =
  'overflow-x-auto overflow-y-clip [--table-sticky-offset:0px]';

/**
 * A header cell that stays under the masthead while the page scrolls.
 *
 * `top` is the masthead's own height, published as `--masthead-height` by
 * `Layout`: the bar is 56px on a phone and ~93px from `sm` up, because the
 * dateline is hidden below `sm`, so a single offset would either leave a gap or
 * tuck the head under the bar. Measuring it also survives the mobile menu and
 * the live label changing width. Inside a sideways scroller the offset is zero
 * instead (see `TABLE_SCROLL`) — a head that cannot reach the masthead must not
 * float over the rows below it.
 *
 * The bottom hairline is an inset shadow rather than the row's `border-b`.
 * With `border-collapse` the table paints the collapsed rule in table
 * coordinates, so it stays behind when the head sticks; a shadow is drawn with
 * the cell and travels with it.
 */
export const TH_STICKY =
  'sticky top-[var(--table-sticky-offset,var(--masthead-height,0px))] z-20 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]';

/**
 * A sticky head cell that also freezes its column while the table scrolls
 * sideways below `sm`. It is `PINNED` for a head: the same paper ground and
 * hairline, but a layer above the other sticky cells (20) instead of the body
 * cells' own layer (10), because a header must never slide under a header.
 */
export const TH_PINNED =
  'left-0 z-30 border-r border-border bg-background sm:border-r-0';

/**
 * The same edge `PINNED_MOVED` draws, with the head's bottom rule kept: the two
 * are one `box-shadow`, so the moved header cannot lose its hairline.
 */
export const TH_PINNED_MOVED = `shadow-[8px_0_8px_-8px_hsl(var(--foreground)/0.35),inset_0_-1px_0_hsl(var(--border))] ${PINNED_EDGE}`;

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
        TH_STICKY,
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
