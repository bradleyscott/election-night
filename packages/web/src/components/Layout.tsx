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
  { to: '/parties', label: 'Party List' },
];

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
      <header className="sticky top-0 z-50 bg-gradient-brand shadow-lg shadow-orange-500/10 overflow-visible">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <Link to="/" className="flex items-center gap-2.5 group">
              <Logo className="w-16 h-16 sm:w-18 sm:h-18 drop-shadow" />
              <span className="text-lg sm:text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">
                election-night.live
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <nav className="hidden sm:flex items-center gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'relative px-3 py-2 text-sm font-semibold rounded-lg transition-all',
                      isActive(item.to)
                        ? 'text-white bg-white/20 shadow-sm'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    )}
                  >
                    {item.label}
                    {isActive(item.to) && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 bg-white/60 rounded-full" />
                    )}
                  </Link>
                ))}
              </nav>
              <LiveIndicator />
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="sm:hidden relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors -mr-1"
                aria-label="Toggle navigation menu"
              >
              <div className="w-5 flex flex-col gap-1.5">
                <span
                  className={cn(
                    'block h-0.5 bg-white rounded-full transition-all duration-300',
                    menuOpen ? 'rotate-45 translate-y-1' : ''
                  )}
                />
                <span
                  className={cn(
                    'block h-0.5 bg-white rounded-full transition-all duration-300',
                    menuOpen ? 'opacity-0' : ''
                  )}
                />
                <span
                  className={cn(
                    'block h-0.5 bg-white rounded-full transition-all duration-300',
                    menuOpen ? '-rotate-45 -translate-y-1' : ''
                  )}
                />
              </div>
            </button>
            </div>
          </div>
        </div>

        {menuOpen && (
          <div className="sm:hidden bg-gradient-brand shadow-lg border-t border-white/10 animate-fade-in">
            <nav className="max-w-7xl mx-auto px-4 py-2 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    'block px-3 py-2.5 text-sm font-semibold rounded-lg transition-all',
                    isActive(item.to)
                      ? 'text-white bg-white/20'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className={cn('max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8', showSidebar && 'xl:pr-80')}>
        {children}
      </main>
      {showSidebar && (
        <div className="hidden xl:block fixed right-0 top-16 h-[calc(100vh-4rem)] z-40">
          <FeedSidebar electorateName={sidebarElectorateName} />
        </div>
      )}
    </div>
  );
}
