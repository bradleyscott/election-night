import {
  type ReactNode,
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatPollsCountdown } from '@election-night/core/polls-close';
import { cn } from '../lib/utils.js';
import { usePollsClose } from '../hooks/usePollsClose.js';
import Logo from './Logo.js';
import LiveIndicator from './LiveIndicator.js';
import ThemeToggle from './ThemeToggle.js';
import FeedSidebar from './FeedSidebar.js';
import { CLOSE_CALLS_PATH } from '../lib/routes.js';

const WORDMARK = 'election-night.live';

const navItems = [
  { to: '/', label: 'Seats' },
  { to: CLOSE_CALLS_PATH, label: 'Close Calls' },
  { to: '/electorates', label: 'Electorates' },
  { to: '/flipped', label: 'Flipped' },
  { to: '/candidates', label: 'Candidates' },
  { to: '/feed', label: 'Feed' },
  { to: '/trends', label: 'Trends' },
  { to: '/parties', label: 'Party lists' },
];

/**
 * Keep the wordmark only while every letter of it fits.
 *
 * Between the menu's breakpoint and the width at which the whole masthead sits
 * comfortably, the wordmark is the only flexible thing in the row, so the
 * browser's remedy is an ellipsis — `election-n…`, which reads as broken rather
 * than as a smaller masthead. Hiding it is the honest fallback: the mark and
 * the menu still say whose page this is.
 *
 * The width comes from an invisible copy laid out outside the flow, because
 * measuring the wordmark itself would be self-defeating: hiding it frees
 * exactly the space whose absence said it did not fit, and it would flicker
 * straight back.
 */
function useWordmarkFits() {
  const rowRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const link = linkRef.current;
      const controls = controlsRef.current;
      const probe = probeRef.current;
      if (!row || !link || !controls || !probe) return;

      // No layout to read (jsdom, or before the first paint): leave the
      // wordmark alone rather than hiding it on a measurement of zero.
      const width = row.clientWidth;
      if (width <= 0) return;

      const probeWidth = probe.getBoundingClientRect().width;
      if (probeWidth <= 0) return;

      const rowGap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const linkGap = parseFloat(getComputedStyle(link).columnGap) || 0;
      const logo = link.firstElementChild;
      const logoWidth = logo ? logo.getBoundingClientRect().width : 0;

      const available = width - controls.getBoundingClientRect().width - rowGap;

      // Two pixels of slack for subpixel rounding: a wordmark shown at exactly
      // the available width could still land a hair into `truncate`, and an
      // ellipsis is the one thing this exists to avoid.
      setFits(available >= logoWidth + linkGap + probeWidth + 2);
    };

    measure();

    window.addEventListener('resize', measure);
    // Playfair Display arrives after first paint and is narrower than the
    // fallback, so the first measurement can be too pessimistic.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measure());
    // The row's width follows the window; the controls' width changes as the
    // live label becomes "Live" or "Disconnected".
    if (rowRef.current) observer?.observe(rowRef.current);
    if (controlsRef.current) observer?.observe(controlsRef.current);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  return { rowRef, linkRef, controlsRef, probeRef, fits };
}

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
  const headerRef = useRef<HTMLElement>(null);
  const {
    rowRef,
    linkRef,
    controlsRef,
    probeRef,
    fits: wordmarkFits,
  } = useWordmarkFits();

  // Publish the masthead's height so a table head can park directly beneath it.
  // It is measured rather than hardcoded: the dateline is hidden below `sm`, so
  // the bar is 56px on a phone and ~93px above it, and the measured value also
  // follows the mobile menu opening. The whole `<header>` is the right element
  // to measure because its 2px rule is part of the space a sticky table head has
  // to clear, and the mobile menu is part of the masthead while it is open.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--masthead-height',
        `${header.getBoundingClientRect().height}px`
      );
    };
    publish();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => publish());
    observer?.observe(header, { box: 'border-box' });
    window.addEventListener('resize', publish);
    // The stylesheet is linked at the end of the built document, so the first
    // measurement can land before the masthead's 2px rule has applied. The
    // observer watches the border box for that reason: a border change moves
    // the edge a sticky head must clear but leaves the content box alone, so a
    // default (content-box) observation would never see it.
    window.addEventListener('load', publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('load', publish);
    };
  }, []);

  // Close Calls is an ordinary page, so its entry is active like any other and
  // does not need the hash special-casing it had while it was a section.
  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname === to || location.pathname.startsWith(to);
  };

  const showSidebar = !location.pathname.startsWith('/feed');
  const sidebarElectorateName = useMemo(() => {
    const match = location.pathname.match(/^\/electorates\/(.+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <header
        ref={headerRef}
        className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b-2 border-foreground"
      >
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <Dateline />

          <div
            ref={rowRef}
            className="flex items-center justify-between gap-4 h-14 sm:h-16"
          >
            <Link
              ref={linkRef}
              to="/"
              aria-label={WORDMARK}
              className="relative flex items-center gap-2.5 group min-w-0"
            >
              <Logo className="w-9 h-9 sm:w-10 sm:h-10 shrink-0" />
              {/* The measured width, laid out outside the flow so it survives
                  the wordmark being hidden. Never painted. */}
              <span
                ref={probeRef}
                aria-hidden="true"
                className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap font-display text-xl sm:text-2xl font-bold tracking-tight"
              >
                {WORDMARK}
              </span>
              {wordmarkFits && (
                <span className="font-display text-xl sm:text-2xl font-bold tracking-tight truncate">
                  {WORDMARK}
                </span>
              )}
            </Link>

            <div ref={controlsRef} className="flex items-center gap-1 sm:gap-3">
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
          'max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-4 sm:pt-4 sm:pb-6 lg:pt-5 lg:pb-8',
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
