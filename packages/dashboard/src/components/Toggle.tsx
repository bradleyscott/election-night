import { cn } from '../lib/utils.js';

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ToggleOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  // `w-fit` keeps the control hugging its buttons: as a flex item in a column
  // parent (the Close Calls head on a phone) the default `stretch` would
  // otherwise blow it out to the full width and read as a table.
  //
  // `divide-x` keeps neighbouring options distinct while they are both
  // inactive: without a hairline between them, `# Votes` and `% of Vote` read
  // as one long word rather than two buttons.
  return (
    <div className="flex w-fit border divide-x divide-border overflow-hidden text-sm font-bold flex-shrink-0 font-label">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          className={cn(
            'px-3 py-2 sm:py-1.5 transition-colors min-h-[44px] font-bold',
            value === opt.value
              ? 'bg-foreground text-background'
              : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
