// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CountedTape } from './CountedTape.js';
import type { TapePoint } from './CountedTape.js';

const T0 = Date.parse('2026-11-07T19:04:00Z');
const MIN = 60_000;

const points = (values: number[]): TapePoint[] =>
  values.map((value, i) => ({
    t: T0 + i * 10 * MIN,
    value,
    sub: value > 0 ? `${value * 100} votes` : undefined,
  }));

const base = {
  yTicks: [0, 25, 50, 75, 100],
  formatTick: (v: number) => `${v.toFixed(0)}%`,
  formatValue: (v: number) => `${v.toFixed(1)}%`,
};

function pathOf(container: HTMLElement): string {
  const path = container.querySelector('path');
  expect(path).not.toBeNull();
  return path!.getAttribute('d') ?? '';
}

describe('CountedTape', () => {
  it('steps between scrapes instead of smoothing between them', () => {
    const { container } = render(
      <CountedTape {...base} points={points([10, 24, 24, 41])} />
    );
    const d = pathOf(container);
    // A step is horizontal then vertical; a curve or a diagonal would read as an
    // invented in-between value.
    expect(d).toMatch(/^M [\d.]+ [\d.]+( H [\d.]+ V [\d.]+)+$/);
    expect(d.match(/V/g)).toHaveLength(3);
  });

  it('stops at the last scrape rather than drawing on to midnight', () => {
    const series = points([10, 24, 41]);
    const { container } = render(<CountedTape {...base} points={series} />);

    const path = pathOf(container);
    const lastY = Number(path.trim().split('V ').pop());
    // 41% of a 100% axis, near the bottom of the plot.
    expect(lastY).toBeGreaterThan(0);

    // Nothing is marked past the step: no end dot, no now rule.
    expect(container.querySelector('circle')).toBeNull();
    const inkRules = Array.from(container.querySelectorAll('line')).filter(
      (line) => line.getAttribute('stroke') === 'hsl(var(--foreground))'
    );
    expect(inkRules).toHaveLength(0);
  });

  it('draws one rug tick per receipt and nothing for places still to come', () => {
    const receipts = [T0, T0 + 5 * MIN, T0 + 15 * MIN, T0 + 20 * MIN];
    const { container } = render(
      <CountedTape
        {...base}
        points={points([10, 24, 41])}
        receipts={receipts}
      />
    );
    const ticks = Array.from(container.querySelectorAll('line')).filter(
      (line) =>
        line.getAttribute('stroke') === '#22c55e' &&
        line.getAttribute('x1') === line.getAttribute('x2')
    );
    expect(ticks).toHaveLength(receipts.length);
  });

  it('drops a receipt outside the scanned range instead of stretching the axis', () => {
    const receipts = [T0 - 30 * MIN, T0 + 5 * MIN];
    const { container } = render(
      <CountedTape {...base} points={points([10, 41])} receipts={receipts} />
    );
    const ticks = Array.from(container.querySelectorAll('line')).filter(
      (line) =>
        line.getAttribute('stroke') === '#22c55e' &&
        line.getAttribute('x1') === line.getAttribute('x2')
    );
    expect(ticks).toHaveLength(1);
  });

  it('hides the rug key when no receipt falls inside the scanned range', () => {
    const { container } = render(
      <CountedTape
        {...base}
        points={points([10, 41])}
        receipts={[T0 - 30 * MIN, T0 - 20 * MIN, T0 - 10 * MIN]}
        receiptsLabel="Place reported"
        note="3 / 3 places"
      />
    );
    // The receipts are real but every one landed before the first scrape, so
    // nothing is drawn. A key for a rug that is not there says the chart plots
    // something it does not.
    expect(screen.queryByText('Place reported')).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll('line')).filter(
        (line) =>
          line.getAttribute('stroke') === '#22c55e' &&
          line.getAttribute('x1') === line.getAttribute('x2')
      )
    ).toHaveLength(0);
    // The count of places is not a plot key, so it stays.
    expect(screen.getByText('3 / 3 places')).toBeInTheDocument();
  });

  it('labels the axis and the legend in print terms', () => {
    render(
      <CountedTape
        {...base}
        points={points([10, 41])}
        receipts={[T0 + 5 * MIN]}
        label="Votes counted"
        receiptsLabel="Place reported"
        note="9 / 22 places"
      />
    );
    for (const tick of ['0%', '25%', '50%', '75%', '100%']) {
      expect(screen.getByText(tick)).toBeInTheDocument();
    }
    expect(screen.getByText('Votes counted')).toBeInTheDocument();
    expect(screen.getByText('Place reported')).toBeInTheDocument();
    expect(screen.getByText('9 / 22 places')).toBeInTheDocument();
  });

  it('reserves only the gutter its labels need, not a guessed pad', () => {
    const { container } = render(
      <CountedTape {...base} points={points([10, 41])} />
    );
    const axisLine = Array.from(container.querySelectorAll('line')).find(
      (line) =>
        line.getAttribute('stroke') === 'hsl(var(--muted-foreground))' &&
        line.getAttribute('x1') === line.getAttribute('x2')
    );
    // 4px edge + "100%" at 24px + an 8px gap. The plot used to start at a flat
    // 46px whatever the labels said, which on a phone is a tenth of the chart.
    expect(Number(axisLine!.getAttribute('x1'))).toBe(36);
  });

  it('shows the value and the votes behind it on hover', () => {
    const { container } = render(
      <CountedTape {...base} points={points([10, 41])} />
    );
    fireEvent.pointerMove(container.querySelector('svg')!, { clientX: 40 });
    expect(screen.getAllByText('10.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('1000 votes')).toBeInTheDocument();
  });

  it('says so when nothing has been counted yet', () => {
    render(<CountedTape {...base} points={[]} emptyLabel="No count yet" />);
    expect(screen.getByText('No count yet')).toBeInTheDocument();
  });
});
