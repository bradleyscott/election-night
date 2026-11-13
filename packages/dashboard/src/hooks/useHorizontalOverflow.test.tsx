// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useHorizontalOverflow } from './useHorizontalOverflow.js';

/**
 * jsdom does no layout, so the frame's scroll metrics are written onto the
 * element by hand and a `resize` is fired to make the hook re-measure — the
 * same path a rotation or a window drag takes in a browser.
 */
function setMetrics(
  el: HTMLElement,
  { scrollWidth, clientWidth, scrollLeft = 0 }: Record<string, number>
) {
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    value: scrollWidth,
  });
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    value: clientWidth,
  });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    value: scrollLeft,
    writable: true,
  });
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const { overflows, moreRight, scrolled } = useHorizontalOverflow(ref);
  return (
    <>
      <div ref={ref} data-testid="frame">
        <table>
          <tbody>
            <tr>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </div>
      <output data-testid="state">
        {`${overflows}/${moreRight}/${scrolled}`}
      </output>
    </>
  );
}

function reMeasure(frame: HTMLElement, metrics: Record<string, number>) {
  setMetrics(frame, metrics);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('useHorizontalOverflow', () => {
  test('reports a table that fits as not overflowing, with nowhere to go', () => {
    render(<Harness />);
    const frame = screen.getByTestId('frame');
    reMeasure(frame, { scrollWidth: 356, clientWidth: 356 });

    expect(screen.getByTestId('state').textContent).toBe('false/false/false');
  });

  test('reports a table wider than its frame, with more off to the right', () => {
    render(<Harness />);
    const frame = screen.getByTestId('frame');
    reMeasure(frame, { scrollWidth: 520, clientWidth: 356 });

    expect(screen.getByTestId('state').textContent).toBe('true/true/false');
  });

  test('drops the right-hand hint and raises the pin once the table is scrolled', () => {
    render(<Harness />);
    const frame = screen.getByTestId('frame');
    reMeasure(frame, { scrollWidth: 520, clientWidth: 356, scrollLeft: 60 });

    expect(screen.getByTestId('state').textContent).toBe('true/true/true');
  });

  test('stops calling a table scrollable once it is scrolled to the end', () => {
    render(<Harness />);
    const frame = screen.getByTestId('frame');
    reMeasure(frame, {
      scrollWidth: 520,
      clientWidth: 356,
      scrollLeft: 164,
    });

    expect(screen.getByTestId('state').textContent).toBe('true/false/true');
  });
});
