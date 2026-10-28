// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import Logo from './Logo.js';

/**
 * The masthead mark is the Electoral Commission's Orange Guy — the character it
 * uses to promote enrolment — so it has to stay the character's orange. The
 * Newsprint redesign turned the body the masthead red (`#C8503E → #9E2B1C`) and
 * the character stopped reading as the thing it quotes; `design.md` § Voice
 * records the exception, and this pins it so the next restyle does not repeat it.
 *
 * `lib/app-icons.test.ts` pins the same pair in the install icons, which are
 * generated separately by `scripts/generate-icons.mjs`.
 */
const MASCOT_ORANGE = ['#ff8000', '#ff6600'];

/** The body's gradient stops, in document order. */
function bodyStops(container: HTMLElement) {
  const gradient = container.querySelector('#ogBody');
  if (!gradient) throw new Error('Logo has no #ogBody gradient');
  return Array.from(gradient.querySelectorAll('stop')).map((stop) =>
    stop.getAttribute('stop-color')?.toLowerCase()
  );
}

describe('Logo', () => {
  test('the body is the mascot orange, not the masthead red', () => {
    const { container } = render(<Logo />);
    expect(bodyStops(container)).toEqual(MASCOT_ORANGE);
  });

  test('the body shades without darkening towards red', () => {
    // Both stops sit at the same lightness, so the gradient gives the body form
    // rather than a burnt bottom — a dark second stop is what read as red.
    const [light, deep] = bodyStops(render(<Logo />).container) as string[];
    const lightness = (hex: string) =>
      Math.max(
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
      ) / 255;
    expect(lightness(light)).toBe(1);
    expect(lightness(deep)).toBe(1);
    expect(parseInt(deep.slice(5, 7), 16)).toBe(0); // no blue: a pure orange
  });
});
