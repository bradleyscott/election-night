// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as ReactRouter from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { ElectorateRacesView } from './ElectorateRacesView.js';
import type { ElectorateResults, WithLeaders, WithMarginOfError } from '@election-night/core/types';

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
  marginOfError: 0.02,
  leaders: {
    leadingCandidate: 'SMITH, John',
    leadingCandidateParty: 'National Party',
    secondCandidate: 'JONES, Mary',
    secondCandidateParty: 'Labour Party',
    margin: 1000,
    marginPercent: 0.04,
    predictionStatus: 'leaning',
  },
} as ElectorateResults & WithLeaders & WithMarginOfError;

describe('ElectorateRacesView', () => {
  test('table rows are keyboard accessible', () => {
    render(
      <BrowserRouter>
        <ElectorateRacesView electorates={[baseElectorate]} />
      </BrowserRouter>
    );

    const row = screen.getByRole('button', { name: /View details for Auckland Central/i });
    expect(row).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/electorates/Auckland%20Central');

    mockNavigate.mockClear();
    fireEvent.keyDown(row, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledWith('/electorates/Auckland%20Central');
  });
});
