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
    render(
      <PastWinners
        winners={winners}
        unavailable={false}
        currentLeaderParty="Labour Party"
      />
    );

    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2017')).toBeInTheDocument();
    expect(screen.getAllByText('HIPKINS, Chris')).toHaveLength(2);
    expect(screen.getByText('8,000')).toBeInTheDocument();
    expect(screen.getByText('30.0%')).toBeInTheDocument();
  });

  test('marks the cycle the seat changed hands in', () => {
    render(
      <PastWinners
        winners={winners}
        unavailable={false}
        currentLeaderParty="Labour Party"
      />
    );

    // 2023 was Labour and still is; 2017 was National, so that one flipped.
    expect(screen.getAllByText('Flipped')).toHaveLength(1);
  });

  test('names the seat as it was called in that cycle', () => {
    render(
      <PastWinners
        winners={winners}
        unavailable={false}
        currentLeaderParty="Labour Party"
      />
    );

    expect(
      screen.getByText('National Party · as Rimutaka')
    ).toBeInTheDocument();
  });

  test('says when no prior cycle could be fetched', () => {
    render(
      <PastWinners winners={[]} unavailable currentLeaderParty="Labour Party" />
    );

    expect(
      screen.getByText(/Prior election results are unavailable/)
    ).toBeInTheDocument();
  });

  test('explains a seat with no comparable prior holder', () => {
    render(
      <PastWinners
        winners={[]}
        unavailable={false}
        currentLeaderParty="Labour Party"
      />
    );

    expect(screen.getByText(/No comparable prior holder/)).toBeInTheDocument();
  });
});
