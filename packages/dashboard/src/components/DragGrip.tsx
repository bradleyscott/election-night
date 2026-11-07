import { cn } from '../lib/utils.js';

/**
 * Material Design's `drag_indicator`: six filled circles in two columns.
 *
 * It is the grip people already know from Android lists and Google's own
 * reorderable surfaces, rather than a bespoke mark, so the affordance reads
 * without a label. Inlined rather than pulled from an icon package because it
 * is the only icon the dashboard needs from one.
 *
 * The 24px artwork is cropped to the dots plus a half-unit margin
 * (`viewBox="6.5 2.5 11 19"`), so the handle is 8px wide and 14px tall —
 * 12px with its gap in the Party cell — instead of carrying a 24px icon box's
 * padding inside a phone table.
 *
 * `aria-hidden`: draggability is an interaction, not something to read out.
 */
export function DragGrip({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-drag-grip=""
      viewBox="6.5 2.5 11 19"
      fill="currentColor"
      className={cn(
        'h-3.5 w-2 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground',
        className
      )}
    >
      <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  );
}
