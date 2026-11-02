import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { WinPercentContent } from './WinPercentContent.js';

/**
 * The Win % explainer as a drawer, opened from any surface that prints the
 * number.
 *
 * It is a drawer and not a page because the question is asked *at* a table: the
 * reader wants to know what the column means without losing the column, and the
 * count behind it must not move. It is not a centred dialog either, because the
 * explanation is a long read on a narrow screen — a panel that takes the right
 * edge keeps the numbers visible on the left while it is open.
 *
 * The provider owns the open state so every entry point (three table headers and
 * the Seats page head) shares one drawer rather than each rendering its own.
 */

type WinPercentContextValue = {
  isOpen: boolean;
  /** Open the drawer, remembering what to return focus to. */
  open: (trigger?: HTMLElement | null) => void;
  close: () => void;
};

const WinPercentContext = createContext<WinPercentContextValue | null>(null);

export function useWinPercent(): WinPercentContextValue {
  const value = useContext(WinPercentContext);
  if (!value) {
    throw new Error('useWinPercent must be used inside WinPercentProvider');
  }
  return value;
}

export function WinPercentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const open = useCallback((element?: HTMLElement | null) => {
    trigger.current =
      element ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Return focus to the header cell that opened it, so a keyboard reader is
    // not dropped at the top of the page.
    trigger.current?.focus?.();
  }, []);

  return (
    <WinPercentContext.Provider value={{ isOpen, open, close }}>
      {children}
      <WinPercentDrawer open={isOpen} onClose={close} />
    </WinPercentContext.Provider>
  );
}

function WinPercentDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Lock the page behind the drawer, as the bottom sheet does.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the panel so the drawer is the thing being read.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[760px] flex-col border-l border-border bg-background animate-slide-in-right outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-8">
          <div>
            <div className="kicker">Explainer</div>
            <h2
              id={titleId}
              className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl"
            >
              How we work out Win %
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the explainer"
            className="flex h-9 w-9 flex-none items-center justify-center border border-border font-label text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="overscroll-y-contain overflow-y-auto px-5 py-5 sm:px-8">
          <WinPercentContent />
        </div>
      </div>
    </div>,
    document.body
  );
}
