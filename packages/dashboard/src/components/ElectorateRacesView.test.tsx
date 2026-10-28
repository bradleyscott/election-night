// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as ReactRouter from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { ElectorateRacesView } from './ElectorateRacesView.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import { normalizeElectorateName } from '../lib/electorates.js';
import type {
  ElectorateResults,
  WithLeaders,
} from '@election-night/core/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const baseElectorate = {
  electorateName: 'Auckland Central',
  candidateVotes: [],
  partyVotes: [],
  votesCounted: 1000,
  votePercentageCounted: 0.5,
  leaders: {
    leadingCandidate: 'SMITH, John',
    leadingCandidateParty: 'National Party',
    secondCandidate: 'JONES, Mary',
    secondCandidateParty: 'Labour Party',
    margin: 1000,
    marginPercent: 0.04,
  },
} as ElectorateResults & WithLeaders;

const counting: SeatChance = {
  state: 'counting',
  leader: { name: 'SMITH, John', party: 'National Party', votes: 5400 },
  runnerUp: { name: 'JONES, Mary', party: 'Labour Party', votes: 5300 },
  othersProbability: 0,
  probability: 0.44,
  margin: 100,
  remainingVotes: 9000,
  remainingLow: 6000,
  remainingHigh: 12000,
  progress: 0.375,
  enrolment: 45407,
  assumedCycle: false,
  insideOutstanding: true,
  specialsOutstanding: 5000,
  insideSpecials: true,
  provisionalPrior: false,
};

describe('ElectorateRacesView', () => {
  test('table rows are keyboard accessible', () => {
    render(
      <BrowserRouter>
        <ElectorateRacesView electorates={[baseElectorate]} />
      </BrowserRouter>
    );

    const row = screen.getByRole('button', {
      name: /View details for Auckland Central/i,
    });
    expect(row).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(
      '/electorates/Auckland%20Central'
    );

    mockNavigate.mockClear();
    fireEvent.keyDown(row, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledWith(
      '/electorates/Auckland%20Central'
    );
  });

  test('names each candidate’s party beside them', () => {
    render(
      <BrowserRouter>
        <ElectorateRacesView electorates={[baseElectorate]} />
      </BrowserRouter>
    );

    // The dot alone is decoration; the party has to be readable, as it is on
    // the Flipped table.
    expect(screen.getByText('National Party')).toBeInTheDocument();
    expect(screen.getByText('Labour Party')).toBeInTheDocument();
  });

  test('shows a chance of winning instead of a margin of error', () => {
    render(
      <BrowserRouter>
        <ElectorateRacesView
          electorates={[baseElectorate]}
          chances={
            new Map([[normalizeElectorateName('Auckland Central'), counting]])
          }
        />
      </BrowserRouter>
    );

    expect(screen.getByText('Win %')).toBeInTheDocument();
    expect(screen.getByText('44%')).toBeInTheDocument();
    expect(screen.queryByText('MoE')).not.toBeInTheDocument();
    expect(screen.queryByText(/±/)).not.toBeInTheDocument();
  });
});
