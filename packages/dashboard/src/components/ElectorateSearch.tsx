import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils.js';

export function ElectorateSearch({ names }: { names: string[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useRef(`electorate-search-list-${Math.random().toString(36).slice(2)}`).current;
  const timeoutRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const filtered = query
    ? names.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : names;

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current ?? undefined);
    };
  }, []);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const selectName = (name: string) => {
    navigate(`/electorates/${encodeURIComponent(name)}`);
    close();
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = prev + 1;
        return next >= filtered.length ? 0 : next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = prev - 1;
        return next < 0 ? filtered.length - 1 : next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const name = filtered[activeIndex];
      if (name) {
        selectName(name);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const activeId =
    open && activeIndex >= 0 && filtered[activeIndex]
      ? `${listId}-option-${activeIndex}`
      : undefined;

  return (
    <div className="relative w-full sm:w-auto text-sm">
      <label className="sr-only" htmlFor="electorate-search-input">
        Search electorate
      </label>
      <input
        id="electorate-search-input"
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-expanded={open && filtered.length > 0}
        aria-activedescendant={activeId}
        placeholder="Search electorate…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          timeoutRef.current = setTimeout(() => close(), 200);
        }}
        onKeyDown={handleKeyDown}
        className="w-full sm:w-56 px-3 py-2 sm:py-1.5 border bg-background font-label text-sm outline-none focus:ring-2 focus:ring-ring/25 transition-shadow"
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-popover border max-h-64 overflow-y-auto z-50 animate-fade-in"
        >
          {filtered.map((name, i) => (
            <li
              key={name}
              id={`${listId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => selectName(name)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'px-3 py-2 sm:py-1.5 cursor-pointer border-b last:border-0 transition-colors font-label text-sm',
                i === activeIndex ? 'bg-muted' : 'hover:bg-muted/40'
              )}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {open && query && filtered.length === 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-popover border z-50 animate-fade-in">
          <li className="px-3 py-2 sm:py-1.5 text-muted-foreground font-label text-sm">
            No matches
          </li>
        </ul>
      )}
    </div>
  );
}
