// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  VotingPlaceStatus,
  VotingPlacesResponse,
} from '@election-night/core/voting-places';
import { VotingPlaceLedger, VotingPlaceLegend } from './VotingPlaces.js';
import type { VotingPlaceSummary } from '../hooks/useVotingPlaces.js';
import {
  formatReceiptTime,
  summarizePlaces,
} from '../hooks/useVotingPlaces.js';

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
  const times = places
    .map((p) => p.countedAt)
    .filter((t): t is string => t !== null)
    .sort();

  return {
    counted: places.filter((p) => p.countedAt !== null).length,
    total: places.length,
    latestAt: times[times.length - 1] ?? null,
    places,
  };
};

describe('VotingPlaceLedger', () => {
  it('counts the places that stand in the electorate', () => {
    render(
      <VotingPlaceLedger
        summary={summary([
          place('101', 'seat', '2023-10-14T19:07:00'),
          place('102', 'seat', null),
        ])}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('/ 2')).toBeInTheDocument();
    expect(screen.getByText('counted')).toBeInTheDocument();
    expect(screen.getByText('in this electorate')).toBeInTheDocument();
    expect(
      screen.getByLabelText('1 of 2 voting places counted')
    ).toBeInTheDocument();
  });

  it('carries no per-group breakdown', () => {
    // The card states one measure only: booths standing in this electorate.
    // Advance hubs and mobile teams are not booths in it, so they are not rows.
    render(
      <VotingPlaceLedger
        summary={summary([
          place('101', 'seat', '2023-10-14T19:07:00'),
          place('102', 'seat', null),
        ])}
      />
    );

    for (const label of [
      'In this electorate',
      'Elsewhere',
      'Mobile voting teams',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
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

  it('says it is still reading before the first answer arrives', () => {
    render(
      <VotingPlaceLedger
        summary={summary([place('101', 'seat', null)])}
        loading
      />
    );

    expect(screen.getByText('reading places…')).toBeInTheDocument();
  });
});

describe('VotingPlaceLegend', () => {
  it('keys the two fill states and nothing else', () => {
    const { container } = render(<VotingPlaceLegend />);
    const pips = container.querySelectorAll('.voting-place-pip');

    expect(pips).toHaveLength(2);
    expect(pips[0]).not.toHaveClass('voting-place-pip--open');
    expect(pips[1]).toHaveClass('voting-place-pip--open');
    expect(screen.getByText('Counted')).toBeInTheDocument();
    expect(screen.getByText('Not yet counted')).toBeInTheDocument();
    expect(container.querySelector('.voting-place-pip--circle')).toBeNull();
  });
});

describe('summarizePlaces', () => {
  const response = (
    places: VotingPlaceStatus[],
    available = true
  ): VotingPlacesResponse => ({
    electorateName: 'Epsom',
    year: '2026',
    available,
    reason: available ? null : 'not-live',
    counted: places.filter((p) => p.countedAt !== null).length,
    total: places.length,
    places,
  });

  it('keeps only the places standing in the electorate', () => {
    const summary = summarizePlaces(
      response([
        place('101', 'seat', '2026-10-24T19:07:00'),
        place('102', 'seat', null),
        place('103', 'elsewhere', '2026-10-24T19:31:00'),
        place('104', 'mobile', null),
      ])
    );

    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(2);
    expect(summary!.counted).toBe(1);
    expect(summary!.latestAt).toBe('2026-10-24T19:07:00');
    expect(summary!.places.map((p) => p.group)).toEqual(['seat', 'seat']);
  });

  it('answers null for a seat with no in-seat place', () => {
    // All seven Māori seats: `vp_e_no` never names a Māori electorate, so every
    // place that counts towards one is filed under a general electorate.
    const summary = summarizePlaces(
      response([
        place('101', 'elsewhere', '2026-10-24T19:07:00'),
        place('102', 'elsewhere', null),
        place('103', 'mobile', '2026-10-24T19:40:00'),
      ])
    );

    expect(summary).toBeNull();
  });

  it('answers null when the cycle has no per-place files', () => {
    expect(summarizePlaces(response([], false))).toBeNull();
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
