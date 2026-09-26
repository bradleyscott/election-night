import { cn } from '../lib/utils.js';

/**
 * Page control for a ruled table — square hairline buttons, one per page.
 *
 * Shared by Close Calls and Flipped so the two tables cannot drift apart:
 * `mt-4` keeps the buttons off the table above, `pb-4` keeps them off the
 * panel's bottom rule. Renders nothing when there is a single page.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const edgeClass = (disabled: boolean) =>
    cn(
      'px-3 py-1 text-sm font-label font-semibold transition-colors border',
      disabled
        ? 'text-muted-foreground/40 border-muted/50 cursor-default'
        : 'text-muted-foreground border-border hover:text-foreground hover:bg-muted/40'
    );

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-1 mt-4 pb-4"
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className={edgeClass(page === 0)}
      >
        Prev
      </button>
      {Array.from({ length: totalPages }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          aria-current={i === page ? 'page' : undefined}
          className={cn(
            'w-8 h-8 text-sm font-label font-semibold transition-colors border',
            i === page
              ? 'bg-foreground text-background border-foreground'
              : 'text-muted-foreground border-border hover:text-foreground hover:bg-muted/40'
          )}
        >
          {i + 1}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page === totalPages - 1}
        className={edgeClass(page === totalPages - 1)}
      >
        Next
      </button>
    </nav>
  );
}
