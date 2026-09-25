import { type ReactNode, useState, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatPollsCountdown } from '@election-night/core/polls-close';
import { cn } from '../lib/utils.js';
import { usePollsClose } from '../hooks/usePollsClose.js';
import Logo from './Logo.js';
import LiveIndicator from './LiveIndicator.js';
import ThemeToggle from './ThemeToggle.js';
import FeedSidebar from './FeedSidebar.js';

const navItems = [
  { to: '/', label: 'Seats' },
  { to: '/electorates', label: 'Electorates' },
  { to: '/close-calls', label: 'Close Calls' },
  { to: '/flipped', label: 'Flipped' },
  { to: '/feed', label: 'Feed' },
  { to: '/trends', label: 'Trends' },
  { to: '/parties', label: 'Party lists' },
];

/**
 * The dateline's right-hand value. Before polls close it counts down to
 * 7:00pm; on election night it becomes the counting state; for an archived
 * cycle (or when the server cannot say when polls close) it falls back to the
 * plain clock, which is all that can honestly be shown.
 */
function DatelineValue({ now }: { now: Date }) {
  const { phase, countdown, closesAt } = usePollsClose();

  if (phase === 'counting') {
    return (
      <span className="inline-flex items-center gap-1.5 font-bold text-brand">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse-live"
          aria-hidden="true"
        />
        Polls closed · counting
      </span>
    );
  }

  if (phase === 'upcoming' && countdown && closesAt) {
    return (
      <time dateTime={closesAt.toISOString()} className="tabular-nums">
        Polls close in {formatPollsCountdown(countdown)}
      </time>
    );
  }

  return (
    <span className="tabular-nums tracking-normal">
      {now.toLocaleDateString('en-NZ', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })}{' '}
      ·{' '}
      {now.toLocaleTimeString('en-NZ', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })}
    </span>
  );
}

function Dateline() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden sm:flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.09em] text-muted-foreground border-b border-border py-1.5 font-label">
      <span>NZ General Election</span>
      <DatelineValue now={now} />
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (to: string) =>
    location.pathname === to ||
    (to !== '/' && location.pathname.startsWith(to));

  const showSidebar = !location.pathname.startsWith('/feed');
  const sidebarElectorateName = useMemo(() => {
    const match = location.pathname.match(/^\/electorates\/(.+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b-2 border-foreground">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <Dateline />

          <div className="flex items-center justify-between gap-4 h-14 sm:h-16">
            <Link to="/" className="flex items-center gap-2.5 group min-w-0">
              <Logo className="w-9 h-9 sm:w-10 sm:h-10 shrink-0" />
              <span className="font-display text-xl sm:text-2xl font-bold tracking-tight truncate">
                election-night.live
              </span>
            </Link>

            <div className="flex items-center gap-1 sm:gap-3">
              <nav className="hidden md:flex items-center gap-0.5">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'px-3 py-2 text-[11px] font-label font-semibold uppercase tracking-[0.07em] transition-colors',
                      isActive(item.to)
                        ? 'text-brand'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <LiveIndicator />
              <ThemeToggle />
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden relative w-9 h-9 flex items-center justify-center hover:bg-muted transition-colors"
                aria-label="Toggle navigation menu"
                aria-expanded={menuOpen}
              >
                <div className="w-5 flex flex-col gap-1.5">
                  <span
                    className={cn(
                      'block h-0.5 bg-foreground transition-[transform,opacity] duration-300',
                      menuOpen ? 'rotate-45 translate-y-2' : ''
                    )}
                  />
                  <span
                    className={cn(
                      'block h-0.5 bg-foreground transition-[transform,opacity] duration-300',
                      menuOpen ? 'opacity-0' : ''
                    )}
                  />
                  <span
                    className={cn(
                      'block h-0.5 bg-foreground transition-[transform,opacity] duration-300',
                      menuOpen ? '-rotate-45 -translate-y-2' : ''
                    )}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-border bg-background animate-fade-in">
            <nav className="max-w-screen-2xl mx-auto px-4 py-2">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    'block px-3 py-2.5 text-sm font-label font-semibold uppercase tracking-[0.07em] transition-colors border-b border-border last:border-0',
                    isActive(item.to)
                      ? 'text-brand'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main
        className={cn(
          'max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8',
          showSidebar && 'lg:pr-80'
        )}
      >
        {children}
      </main>
      {showSidebar && (
        <div className="hidden lg:block fixed right-0 top-24 h-[calc(100vh-6rem)] z-40">
          <FeedSidebar electorateName={sidebarElectorateName} />
        </div>
      )}
    </div>
  );
}
