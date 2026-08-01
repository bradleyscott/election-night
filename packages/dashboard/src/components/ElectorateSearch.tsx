import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export function ElectorateSearch({ names }: { names: string[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = query
    ? names.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : names;

  return (
    <div className="relative w-full sm:w-auto text-sm">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search electorate…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="w-full sm:w-56 px-3 py-2 sm:py-1.5 border bg-background font-label text-sm outline-none focus:ring-2 focus:ring-ring/25 transition-shadow"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-popover border max-h-64 overflow-y-auto z-50 animate-fade-in">
          {filtered.map((name) => (
            <li
              key={name}
              onMouseDown={() => {
                navigate(`/electorates/${encodeURIComponent(name)}`);
                setOpen(false);
                setQuery('');
              }}
              className="px-3 py-2 sm:py-1.5 cursor-pointer hover:bg-muted/40 border-b last:border-0 transition-colors font-label text-sm"
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
