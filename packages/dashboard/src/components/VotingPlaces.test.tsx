// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { VotingPlaceStatus } from '@election-night/core/voting-places';
import { VotingPlaceLedger, VotingPlaceLegend } from './VotingPlaces.js';
import type { VotingPlaceSummary } from '../hooks/useVotingPlaces.js';
import { formatReceiptTime } from '../hooks/useVotingPlaces.js';

const place = (
  id: string,
  group: VotingPlaceStatus['group'],
  countedAt: string | null
): VotingPlaceStatus => ({
  id: Number(id.replace(/\D/g, '')) || 1,
  name: `Place ${id}`,
  address: `1 Example Street, ${id}`,
  lat: null,
  lon: null,
  electorateName: 'Epsom',
  group,
  countedAt,
});

const summary = (places: VotingPlaceStatus[]): VotingPlaceSummary => {
  const groups = (['seat', 'advance', 'mobile'] as const)
    .map((key) => {
      const inGroup = places.filter((p) => p.group === key);
      return {
        key,
        counted: inGroup.filter((p) => p.countedAt !== null).length,
        total: inGroup.length,
      };
    })
    .filter((g) => g.total > 0);

  const times = places
    .map((p) => p.countedAt)
    .filter((t): t is string => t !== null)
    .sort();

  return {
    counted: places.filter((p) => p.countedAt !== null).length,
    total: places.length,
    latestAt: times[times.length - 1] ?? null,
    groups,
    places,
  };
};

describe('VotingPlaceLedger', () => {
  it('totals the places and breaks them down by group', () => {
    render(
      <VotingPlaceLedger
        summary={summary([
          place('101', 'seat', '2023-10-14T19:07:00'),
          place('102', 'seat', null),
          place('103', 'advance', null),
          place('104', 'mobile', '2023-10-14T19:31:00'),
        ])}
      />
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('/ 4')).toBeInTheDocument();
    expect(screen.getByText('In this electorate')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Advance voting places')).toBeInTheDocument();
    expect(screen.getByText('Mobile voting teams')).toBeInTheDocument();
  });

  it('prints the newest receipt time and nothing before one lands', () => {
    const { rerender } = render(
      <VotingPlaceLedger
        summary={summary([place('101', 'seat', '2023-10-14T19:07:00')])}
      />
    );
    expect(screen.getByText('7:07pm')).toBeInTheDocument();

    rerender(
      <VotingPlaceLedger summary={summary([place('101', 'seat', null)])} />
    );
    expect(screen.queryByText(/\d+:\d\d[ap]m/)).not.toBeInTheDocument();
  });

  it('drops a group with no places rather than showing a zero', () => {
    render(
      <VotingPlaceLedger summary={summary([place('101', 'seat', null)])} />
    );

    expect(screen.queryByText('Advance voting places')).not.toBeInTheDocument();
    expect(screen.queryByText('Mobile voting teams')).not.toBeInTheDocument();
  });
});

describe('VotingPlaceLegend', () => {
  it('keys each pip state', () => {
    const { container } = render(<VotingPlaceLegend />);
    const pips = container.querySelectorAll('.voting-place-pip');

    expect(pips).toHaveLength(4);
    expect(pips[0]).toHaveClass('voting-place-pip--square');
    expect(pips[0]).not.toHaveClass('voting-place-pip--open');
    expect(pips[1]).toHaveClass('voting-place-pip--open');
    expect(pips[2]).toHaveClass('voting-place-pip--circle');
    expect(pips[3]).toHaveClass('voting-place-pip--circle');
    expect(pips[3]).toHaveClass('voting-place-pip--open');
  });
});

describe('formatReceiptTime', () => {
  it('prints the clock time the feed wrote', () => {
    expect(formatReceiptTime('2023-10-14T19:07:00')).toBe('7:07pm');
    expect(formatReceiptTime('2023-10-14T20:31:42')).toBe('8:31pm');
    expect(formatReceiptTime('2023-10-14T00:05:00')).toBe('12:05am');
    expect(formatReceiptTime('2023-10-14T12:00:00')).toBe('12:00pm');
  });

  it('does not shift the time into the reader time zone', () => {
    // The feed writes New Zealand wall clock; a UTC+13 device and a UTC-8
    // device must both read the time the count landed on election night.
    expect(formatReceiptTime('2023-10-14T19:07:00Z')).toBe('7:07pm');
  });

  it('leaves an unparseable value alone', () => {
    expect(formatReceiptTime('unknown')).toBe('unknown');
  });
});
