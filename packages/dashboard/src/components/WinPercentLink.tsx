import { cn } from '../lib/utils.js';
import { useWinPercent } from './WinPercentDrawer.js';

/**
 * The one way into the Win % explainer.
 *
 * The column header is the only cell that belongs to the column rather than to
 * a candidate, and on Close Calls and Flipped the rows themselves are click
 * targets, so the header is where the affordance has to live. The label sits
 * above a second line, `ⓘ How it works`: the mark alone was a footnote a reader
 * had to decode, and the words say what the click does. The line is small and
 * set in sentence case so it reads as a subtitle to the column rather than as a
 * button competing with the data.
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
        'group flex w-full flex-col items-end gap-0.5 whitespace-nowrap uppercase text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
    >
      <span className="leading-none">Win %</span>
      {/* The button's `uppercase` would print this line "HOW IT WORKS", so it
          restates `normal-case` the same way the label restates `uppercase`.
          The tight tracking keeps a sentence-cased line under a tracked
          heading from looking wider than the label it sits beneath. */}
      <span className="flex items-center gap-1 text-[11px] font-normal normal-case leading-none tracking-normal group-hover:underline group-hover:decoration-foreground group-hover:underline-offset-2">
        <span aria-hidden="true" className="font-mono">
          ⓘ
        </span>
        How it works
      </span>
    </button>
  );
}
