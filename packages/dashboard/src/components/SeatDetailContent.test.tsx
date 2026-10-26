// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SeatDetailContent } from './SeatDetailContent.js';
import type { SeatInfo } from '../lib/parliament.js';
import type { SeatChance } from '@election-night/core/seat-probability';

function seat(overrides: Partial<SeatInfo> = {}): SeatInfo {
  return {
    party: 'National Party',
    color: '#00529F',
    opacity: 0.8,
    type: 'electorate',
    name: 'Testville',
    candidate: 'SMITH, Alex',
    margin: 200,
    marginPercent: 0.012,
    ...overrides,
  };
}

const counting: SeatChance = {
  state: 'counting',
  othersProbability: 0.01,
  leader: { name: 'SMITH, Alex', party: 'National Party', votes: 5100 },
  runnerUp: { name: 'JONES, Bo', party: 'Labour Party', votes: 4900 },
  probability: 0.91,
  margin: 200,
  remainingVotes: 3000,
  remainingLow: 2400,
  remainingHigh: 3600,
  progress: 0.6,
  enrolment: 45000,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 7300,
  insideSpecials: true,
  provisionalPrior: false,
};

function renderSeat(info: SeatInfo) {
  return render(
    <MemoryRouter>
      <SeatDetailContent info={info} onClose={() => {}} />
    </MemoryRouter>
  );
}

describe('SeatDetailContent', () => {
  it('shows the chance of winning instead of a prediction chip', () => {
    renderSeat(seat({ chance: counting }));

    expect(screen.getByText('Win %')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.queryByText(/Likely winner|Leaning|Too close to call/)).toBeNull();
  });

  it('never prints a margin of error', () => {
    const { container } = renderSeat(seat({ chance: counting }));
    expect(container.textContent).not.toMatch(/±|MoE|margin of error/i);
  });

  it('omits the chance when the count has finished', () => {
    renderSeat(
      seat({
        margin: 396,
        chance: {
          state: 'complete',
          margin: 396,
          leader: { name: 'SMITH, Alex', party: 'National Party', votes: 5000 },
          runnerUp: { name: 'JONES, Bo', party: 'Labour Party', votes: 4604 },
        },
      })
    );

    expect(screen.queryByText('Win %')).toBeNull();
    expect(screen.getByText('396 votes')).toBeInTheDocument();
  });

  it('omits the chance when there are no votes yet', () => {
    renderSeat(seat({ chance: { state: 'waiting' } }));
    expect(screen.queryByText('Win %')).toBeNull();
  });
});
