import { describe, expect, it } from 'vitest';
import { axisLabelWidth, formatEstimate, formatVotes } from './chart-format.js';

describe('axisLabelWidth', () => {
  it('sizes the gutter to the widest label at the tick size', () => {
    // IBM Plex Mono advances 0.6em, so at the 10px tick size a glyph is 6px:
    // "100%" is 24px, and the axis reserves that rather than a fixed 60px.
    expect(axisLabelWidth(['0%', '25%', '100%'])).toBe(24);
    expect(axisLabelWidth(['0', '15', '60'])).toBe(12);
    expect(axisLabelWidth(['0', '1.4M'])).toBe(24);
  });

  it('has nothing to reserve when there is no label', () => {
    expect(axisLabelWidth([])).toBe(0);
  });
});

describe('formatVotes', () => {
  it('prints a counted figure exactly', () => {
    expect(formatVotes(8412)).toBe('8,412');
    expect(formatVotes(393)).toBe('393');
  });

  it('rounds a fractional estimate to the vote rather than printing decimals', () => {
    expect(formatVotes(6307.826)).toBe('6,308');
  });
});

describe('formatEstimate', () => {
  it('rounds to two significant figures whatever the magnitude', () => {
    // The same rule at every size: the error is relative (national turnout and
    // night-share constants applied per seat, `REMAINING_SIZE_SD` = 12%), so a
    // smaller estimate does not carry more trustworthy digits.
    expect(formatEstimate(5723)).toBe('5,700');
    expect(formatEstimate(6307.826)).toBe('6,300');
    expect(formatEstimate(9750)).toBe('9,800');
    expect(formatEstimate(15327)).toBe('15,000');
    expect(formatEstimate(9300)).toBe('9,300');
    expect(formatEstimate(4500)).toBe('4,500');
  });

  it('keeps a small estimate to two figures rather than to tens', () => {
    expect(formatEstimate(1247)).toBe('1,200');
    expect(formatEstimate(268)).toBe('270');
    expect(formatEstimate(63)).toBe('63');
    expect(formatEstimate(9)).toBe('9');
  });

  it('has something to say when there is no number', () => {
    expect(formatEstimate(Number.NaN)).toBe('—');
    expect(formatEstimate(0)).toBe('0');
  });
});
