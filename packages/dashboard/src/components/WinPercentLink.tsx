import { cn } from '../lib/utils.js';
import { useWinPercent } from './WinPercentDrawer.js';

/**
 * The one way into the Win % explainer.
 *
 * The column header is the only cell that belongs to the column rather than to
 * a candidate, and on Seats, Close Calls and Flipped the rows themselves are
 * click targets, so the header is where the affordance has to live. A plain
 * label with a muted circled i: a footnote mark beside the data, not a button
 * competing with it.
 *
 * The button fills its cell, so the whole header is the target, and it opens
 * the one drawer the provider owns (`WinPercentDrawer.tsx`) rather than
 * navigating away from a table the reader is in the middle of reading.
 */
export function WinPercentLink({ className }: { className?: string }) {
  const { open } = useWinPercent();

  return (
    <button
      type="button"
      onClick={(event) => open(event.currentTarget)}
      aria-label="How we work out Win %"
      aria-haspopup="dialog"
      className={cn(
        // Tailwind's preflight sets `text-transform: none` on buttons, so
        // without restating it here this label reads "Win %" while every
        // heading beside it is uppercased by `TH_CLASS`.
        'inline-flex w-full items-center justify-end gap-1 whitespace-nowrap uppercase text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
    >
      Win %
      <span aria-hidden="true" className="font-mono text-[9px]">
        ⓘ
      </span>
    </button>
  );
}
