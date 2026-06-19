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
  return (
    <div className="flex rounded-lg border overflow-hidden text-sm font-bold flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={cn(
            'px-3 py-2 sm:py-1.5 transition-colors min-h-[44px] font-bold',
            value === opt.value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-background text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
