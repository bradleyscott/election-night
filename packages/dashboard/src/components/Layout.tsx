import { type ReactNode, useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import Logo from './Logo.js';
import LiveIndicator from './LiveIndicator.js';
import FeedSidebar from './FeedSidebar.js';

const navItems = [
  { to: '/', label: 'Seats' },
  { to: '/electorates', label: 'Electorates' },
  { to: '/close-calls', label: 'Close Calls' },
  { to: '/feed', label: 'Feed' },
  { to: '/trends', label: 'Trends' },
  { to: '/parties', label: 'Party lists' },
];

function Dateline() {
  return (
    <div className="hidden sm:flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.09em] text-muted-foreground border-b border-border py-1.5 font-label">
      <span>NZ General Election</span>
      <span className="tabular-nums tracking-normal">
        {new Date().toLocaleDateString('en-NZ', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })}{' '}
        ·{' '}
        {new Date().toLocaleTimeString('en-NZ', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}
      </span>
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
                      menuOpen ? 'rotate-45 translate-y-1' : ''
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
                      menuOpen ? '-rotate-45 -translate-y-1' : ''
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

      <main className={cn('max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8', showSidebar && 'lg:pr-80')}>
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
