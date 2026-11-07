import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Where a sideways-scrolling table has got to, so the page can say so.
 *
 * `moreRight` draws the fade that tells a phone reader a column is still over
 * there; `scrolled` raises the pinned first column once cells are passing
 * under it, so they read as depth rather than as clipped text. Both are false
 * on every wider screen, where the columns fit and nothing moves.
 *
 * It is measured rather than drawn once — on mount, on scroll and on resize (a
 * rotation or a window drag changes how much fits) — and `reMeasureKey` redraws
 * the table when the rows change (a search, a new page), which changes its
 * width.
 */
export function useHorizontalOverflow(
  ref: RefObject<HTMLElement | null>,
  reMeasureKey?: unknown
) {
  const [moreRight, setMoreRight] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      setScrolled(el.scrollLeft > 1);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [ref, reMeasureKey]);

  return { moreRight, scrolled };
}
