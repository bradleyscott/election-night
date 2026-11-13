import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Where a sideways-scrolling table has got to, so the page can say so.
 *
 * `overflows` is whether the table is actually wider than the frame it sits in.
 * It decides whether the frame is a scroller at all, which is not cosmetic: a
 * `overflow-x` frame is a scroll container on *both* axes whatever
 * `overflow-y` says (`clip` next to `auto` computes to `hidden`), and a sticky
 * head inside it is then positioned against that frame — a content-sized box
 * that never scrolls — so `top` displaces the head down over the first rows
 * instead of parking it under the masthead. A table that fits therefore drops
 * the scroller classes and keeps a page-anchored head; one that does not gets
 * `--table-sticky-offset: 0` so its head stays put rather than covering rows.
 *
 * `moreRight` draws the fade that tells a phone reader a column is still over
 * there; `scrolled` raises the pinned first column once cells are passing under
 * it, so they read as depth rather than as clipped text. Both are false on
 * every wider screen, where the columns fit and nothing moves.
 *
 * It is measured rather than drawn once — before the first paint, on scroll and
 * on resize (a rotation or a window drag changes how much fits) — and
 * `reMeasureKey` re-measures when the rows change (a search, a new page), which
 * changes the table's width. The initial `true` is the safe side to be wrong
 * on: a frame that is needlessly scrollable clips nothing, while a frame that
 * should scroll and does not puts the table's edge off the page until the
 * measurement lands.
 */
export function useHorizontalOverflow(
  ref: RefObject<HTMLElement | null>,
  reMeasureKey?: unknown
) {
  const [overflows, setOverflows] = useState(true);
  const [moreRight, setMoreRight] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const excess = el.scrollWidth - el.clientWidth;
      setOverflows(excess > 1);
      setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      setScrolled(el.scrollLeft > 1);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // A row set that changes width (a search, a new page, the first payload)
    // changes nothing about the frame's own box, so no resize event fires.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measure());
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref, reMeasureKey]);

  return { overflows, moreRight, scrolled };
}
