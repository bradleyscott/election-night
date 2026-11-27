import { describe, expect, test } from 'vitest';
import { CHAMBER_ROWS, CHAMBER_WIDTH, chamberLayout } from './chamber.js';

describe('chamberLayout', () => {
  const layout = chamberLayout(123);
  const columns = Math.ceil(123 / CHAMBER_ROWS);

  test('one position per seat, all finite', () => {
    expect(layout.seats).toHaveLength(123);
    for (const seat of layout.seats) {
      expect(Number.isFinite(seat.x)).toBe(true);
      expect(Number.isFinite(seat.y)).toBe(true);
      expect(seat.size).toBeGreaterThan(0);
    }
  });

  test('the order runs from the bottom of the left bench to the bottom of the right', () => {
    const first = layout.seats[0];
    const half = first.size / 2;
    // Centred on its position, so the outermost seat's edge is the frame edge.
    expect(first.x - half).toBeGreaterThan(-0.001);
    expect(first.x - half).toBeLessThan(1);

    const outerEnd = layout.seats[(columns - 1) * CHAMBER_ROWS];
    expect(CHAMBER_WIDTH - (outerEnd.x + half)).toBeGreaterThan(-0.001);
    expect(CHAMBER_WIDTH - (outerEnd.x + half)).toBeLessThan(1);
    expect(outerEnd.y).toBeCloseTo(first.y, 6);

    // Every seat stays inside the frame.
    for (const seat of layout.seats) {
      expect(seat.x - half).toBeGreaterThanOrEqual(-0.001);
      expect(seat.x + half).toBeLessThanOrEqual(CHAMBER_WIDTH + 0.001);
    }

    // Nothing rises above the straight benches except the round end.
    const top = Math.min(...layout.seats.map((s) => s.y));
    expect(top).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(first.y - layout.width);
  });

  test('the drawing mirrors about the centre line', () => {
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < CHAMBER_ROWS; r++) {
        const a = layout.seats[c * CHAMBER_ROWS + r];
        const b = layout.seats[(columns - 1 - c) * CHAMBER_ROWS + r];
        expect(a.x + b.x).toBeCloseTo(CHAMBER_WIDTH, 6);
        expect(a.y).toBeCloseTo(b.y, 6);
      }
    }
  });

  test('the majority divider falls in the gap between the two middle columns', () => {
    // 123 seats is 41 columns, an odd count: the apex sits on a column, so the
    // divider shifts half a column into the gap beside it.
    const midLeft = layout.seats[20 * CHAMBER_ROWS];
    const midRight = layout.seats[21 * CHAMBER_ROWS];
    expect(midLeft.x).toBeCloseTo(CHAMBER_WIDTH / 2, 6);
    expect(layout.marker.x).toBeGreaterThan(midLeft.x);
    expect(layout.marker.x).toBeLessThan(midRight.x);
    // Near-vertical, and long enough to cross the three rings.
    expect(Math.abs(layout.marker.angle)).toBeLessThan(0.1);
    expect(layout.marker.length).toBeGreaterThan(3 * layout.seats[0].size);
    // The label hangs just above the back bench.
    expect(layout.marker.labelY).toBeLessThan(layout.marker.y);
  });

  test('an even column count keeps the divider at the apex, not through a seat', () => {
    // 130 seats is 44 columns: the 2026 chamber. Its geometric centre is
    // already a gap, so the divider must not shift onto the next column. It
    // did, which put four National-led bloc seats on the far side of the
    // majority line and made 65 look like enough to govern.
    const even = chamberLayout(130);
    expect(even.marker.x).toBeCloseTo(CHAMBER_WIDTH / 2, 6);

    const m = even.marker;
    const dx = Math.sin(m.angle);
    const dy = Math.cos(m.angle);
    for (const seat of even.seats) {
      const t = (seat.x - m.x) * dx + (seat.y - m.y) * dy;
      if (t < 0 || t > m.length) continue;
      const px = m.x + t * dx;
      const py = m.y + t * dy;
      expect(Math.hypot(seat.x - px, seat.y - py)).toBeGreaterThan(
        seat.size / 2
      );
    }
  });

  test('the frame is the size the desk layout was drawn at', () => {
    expect(layout.width).toBe(CHAMBER_WIDTH);
    expect(layout.height).toBeGreaterThan(500);
    expect(layout.height).toBeLessThan(560);
  });

  test('degenerate counts still produce a usable frame', () => {
    for (const count of [0, 1, 2]) {
      const small = chamberLayout(count);
      expect(small.seats).toHaveLength(count);
      expect(Number.isFinite(small.height)).toBe(true);
      expect(Number.isFinite(small.marker.length)).toBe(true);
      expect(small.marker.length).toBeGreaterThan(0);
    }
  });
});
