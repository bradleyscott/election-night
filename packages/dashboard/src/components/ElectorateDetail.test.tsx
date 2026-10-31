// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElectorateDetail } from './ElectorateDetail.js';
import { mockElectorateResult } from '../test/fixtures.js';
import type { PriorWinner } from '../lib/history-types.js';
import type { SeatChance } from '@election-night/core/seat-probability';

const chance: SeatChance = {
  state: 'counting',
  leader: { name: 'SMITH, John', party: 'National Party', votes: 12000 },
  runnerUp: { name: 'JONES, Mary', party: 'Labour Party', votes: 11000 },
  othersProbability: 0.01,
  probability: 0.62,
  countProbability: 0.6,
  margin: 1000,
  remainingVotes: 9000,
  remainingLow: 7000,
  remainingHigh: 11000,
  progress: 0.72,
  enrolment: 45455,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 8000,
  specialsRequiredSwing: 0.125,
  specialsProbability: 0.79,
  insideSpecials: false,
  provisionalPrior: false,
};

const winners: PriorWinner[] = [
  {
    electorateName: 'Auckland Central',
    priorElectorateName: null,
    year: '2023',
    candidate: 'SWARBRICK, Chlöe',
    party: 'Green Party',
    votes: 16_624,
    majority: 3_896,
    majorityPercent: 0.11,
  },
];

function renderDetail(showPartyVote: boolean) {
  return render(
    <ElectorateDetail
      result={mockElectorateResult}
      showPartyVote={showPartyVote}
      onTogglePartyVote={() => {}}
      historyData={null}
      priorWinners={winners}
      priorUnavailable={false}
      chance={chance}
      updatedAt={new Date()}
    />
  );
}

describe('ElectorateDetail', () => {
  test('shows past winners in candidate view', () => {
    renderDetail(false);

    expect(screen.getByText('Past winners')).toBeInTheDocument();
    expect(screen.getByText('SWARBRICK, Chlöe')).toBeInTheDocument();
  });

  test('puts the count and the projection in one panel, in the count order', () => {
    renderDetail(false);

    // The band is the count's own state; the table follows it with the chance
    // as a column, so nothing is printed twice and nothing faces the other way.
    expect(screen.getByText('Counted')).toBeInTheDocument();
    expect(screen.getByText(/about 9,000 votes/)).toBeInTheDocument();
    expect(screen.getByText('Win %')).toBeInTheDocument();
    expect(
      screen.getByTitle('62% chance of winning the seat')
    ).toBeInTheDocument();
    // When the count last moved sits at the top of the panel.
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
  });

  test('renders no band and no Win % column in party view', () => {
    // The party vote decides a different contest, so there is nothing to
    // project; the count's own state would be a different count's.
    renderDetail(true);

    expect(screen.queryByText('Win %')).not.toBeInTheDocument();
    expect(screen.queryByText('Still out')).not.toBeInTheDocument();
    expect(screen.queryByText(/Updated just now/)).not.toBeInTheDocument();
  });

  test('hides past winners in party view', () => {
    // A seat is won on the candidate vote; the party view is the party vote.
    // Leaving the table there reads as a claim that the party must repeat what
    // its candidate did.
    renderDetail(true);

    expect(screen.queryByText('Past winners')).not.toBeInTheDocument();
    expect(screen.queryByText('SWARBRICK, Chlöe')).not.toBeInTheDocument();
  });
});
