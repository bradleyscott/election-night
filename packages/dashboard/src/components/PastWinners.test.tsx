// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PastWinners } from './PastWinners.js';
import type { PriorWinner } from '../lib/history-types.js';

const winners: PriorWinner[] = [
  {
    electorateName: 'Remutaka',
    priorElectorateName: null,
    year: '2023',
    candidate: 'HIPKINS, Chris',
    party: 'Labour Party',
    votes: 20_000,
    majority: 8_000,
    majorityPercent: 0.3,
  },
  {
    electorateName: 'Remutaka',
    priorElectorateName: 'Rimutaka',
    year: '2017',
    candidate: 'HIPKINS, Chris',
    party: 'National Party',
    votes: 18_000,
    majority: 2_000,
    majorityPercent: 0.06,
  },
];

describe('PastWinners', () => {
  test('lists each prior cycle with winner, party and majority', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2017')).toBeInTheDocument();
    expect(screen.getAllByText('HIPKINS, Chris')).toHaveLength(2);
    // The value is labelled with what it is — a margin in votes — and the
    // percentage says what it is a share of, rather than leaving both to be
    // inferred.
    expect(screen.getAllByText('vote margin')).toHaveLength(2);
    expect(screen.getByText('8,000')).toBeInTheDocument();
    expect(screen.getByText('30.0% of votes cast')).toBeInTheDocument();
  });

  test('names the seat as it was called in that cycle', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    expect(
      screen.getByText('National Party · as Rimutaka')
    ).toBeInTheDocument();
  });

  test('makes no claim about tonight', () => {
    render(<PastWinners winners={winners} unavailable={false} />);

    // Past results stand on their own: the panel does not know (and must not
    // assert) which party is leading the current, partial count.
    expect(screen.queryByText(/Flipped/i)).not.toBeInTheDocument();
  });

  test('says when no prior cycle could be fetched', () => {
    render(<PastWinners winners={[]} unavailable />);

    expect(
      screen.getByText(/Previous elections could not be fetched/)
    ).toBeInTheDocument();
  });

  test('explains a seat with no comparable prior holder', () => {
    render(<PastWinners winners={[]} unavailable={false} />);

    expect(screen.getByText(/No comparable past winner/)).toBeInTheDocument();
  });
});
