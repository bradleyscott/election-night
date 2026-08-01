import { useEffect, useState } from 'react';

const THEME_KEY = 'election-night:theme';
const LIGHT = 'light';
const DARK = 'dark';

function getStoredTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_KEY) === DARK ? DARK : LIGHT;
  } catch {
    return LIGHT;
  }
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getStoredTheme);
  const isDark = theme === DARK;

  // Keep the html class in sync; the inline <head> script handles first paint.
  useEffect(() => {
    document.documentElement.classList.toggle(DARK, isDark);
  }, [isDark]);

  const toggle = () => {
    const next = isDark ? LIGHT : DARK;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable — this visit stays on the chosen theme */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
