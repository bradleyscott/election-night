// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Seats from './Seats.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockResults, mockZeroedResults } from '../test/fixtures.js';
import type { ResultsPayload } from '@election-night/core/types';

function renderSeats(
  results: ResultsPayload | null = mockResults,
  connected = true
) {
  return render(
    <BrowserRouter>
      <MockSocketProvider results={results} connected={connected}>
        <Seats />
      </MockSocketProvider>
    </BrowserRouter>
  );
}

describe('Seats page', () => {
  test('renders seat totals when results are available', () => {
    renderSeats();

    expect(screen.getByText('Total Seats')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.getByText('Parties in Parliament')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('shows the votes counted and how far through tonight the count is', () => {
    renderSeats();

    // 25,000 votes at 55% turnout implies 45,455 enrolled — there is no served
    // cycle here, so no baseline roll to prefer — and the newest cycle's figures
    // apply: 45,455 × 0.795 turnout × 0.78 night share is 28,187, so 88.7% of
    // tonight's vote is in. The 95% the feed reports is the share of *voting
    // places* reported, which is a different question — and the whole point of
    // this column.
    expect(screen.getByText('25,000')).toBeInTheDocument();
    expect(screen.getByText('88.7%')).toBeInTheDocument();
    expect(screen.queryByText('95.0%')).not.toBeInTheDocument();
  });

  test('leaves Close Calls to its own page', () => {
    renderSeats();

    expect(
      screen.queryByRole('heading', { name: 'Close Calls' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Electorate Races' })
    ).not.toBeInTheDocument();
    // The candidate table's search box is the cheapest proof it moved away.
    expect(screen.queryByPlaceholderText(/search candidate/i)).toBeNull();
  });

  test('renders waiting state when no results are available', () => {
    renderSeats(null, false);

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });

  // The feed serves the whole 2026 ballot with every count zeroed, weeks before
  // election day. Rendering it produced a stat strip of 0 / 0 / 0 / — and the
  // Parliament block's own smaller "Awaiting Data" underneath: two ways of
  // saying "nothing yet" on one page, neither of them the tally the rest of the
  // site uses. The page now shows the count's pending state, as Feed and Trends
  // do, until a vote is counted.
  test('shows the awaiting state for the zeroed ballot, not a strip of zeros', () => {
    renderSeats(mockZeroedResults);

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
    expect(screen.queryByText('Total Seats')).not.toBeInTheDocument();
    expect(screen.queryByText('Votes counted')).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting Data')).not.toBeInTheDocument();
  });
});
