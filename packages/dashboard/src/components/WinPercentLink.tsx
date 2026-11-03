import { cn } from '../lib/utils.js';
import { useWinPercent } from './WinPercentDrawer.js';

/**
 * The one way into the Win % explainer.
 *
 * The column header is the only cell that belongs to the column rather than to
 * a candidate, and on Close Calls and Flipped the rows themselves are click
 * targets, so the header is where the affordance has to live. The label wears
 * a dotted rule in its own ink: the rule is the print convention for a term
 * with more to read behind it, and it costs neither the column's width nor a
 * second line, which the words did on a phone. There is no separate mark; the
 * rule is the whole cue. Hovering darkens the label and the rule with it.
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
        'group inline-flex w-full items-center justify-end whitespace-nowrap uppercase text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
    >
      {/* A 2px dotted rule in the label's own ink, not the hairline border
          colour: the header is a control, and the rule has to hold at 13px on
          a phone without a second mark beside it. `currentColor` means the
          hover colour change carries the rule with the word. */}
      <span className="underline decoration-current decoration-dotted decoration-2 underline-offset-4">
        Win %
      </span>
    </button>
  );
}
