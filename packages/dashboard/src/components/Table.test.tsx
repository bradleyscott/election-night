// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { TH_PINNED, TH_STICKY, TABLE_SCROLL } from './Table.js';

/**
 * The two halves of the sticky-head rule have to travel together. A head cell
 * parked at `var(--masthead-height)` inside a sideways scroller is not parked
 * at all — the scroller is its scrollport, a content-sized box that never
 * scrolls, so `top` is pure displacement and the head lands on top of the first
 * rows. That is the bug the pair below prevents: scroller in, offset out.
 */
describe('sticky table head', () => {
  test('parks at the masthead by default, so a head can reach it', () => {
    expect(TH_STICKY).toContain(
      'top-[var(--table-sticky-offset,var(--masthead-height,0px))]'
    );
  });

  test('zeroes the offset inside the sideways scroller', () => {
    expect(TABLE_SCROLL).toContain('overflow-x-auto');
    expect(TABLE_SCROLL).toContain('[--table-sticky-offset:0px]');
  });

  test('keeps the frozen first column a layer above the other heads', () => {
    expect(TH_PINNED).toContain('z-30');
    expect(TH_STICKY).toContain('z-20');
  });
});
