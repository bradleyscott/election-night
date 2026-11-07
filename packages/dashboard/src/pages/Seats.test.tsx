// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Seats from './Seats.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockResults } from '../test/fixtures.js';
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

// The key usePartyOrder reads and writes; a saved order naming the same
// parties is accepted, which is how a changed seating is simulated here.
const ORDER_KEY = 'parliament-party-order:v2';

afterEach(() => {
  localStorage.clear();
});

describe('Seats page', () => {
  test('renders seat totals when results are available', () => {
    renderSeats();

    expect(screen.getByText('Total Seats')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.getByText('Parties in Parliament')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('hides the reset while the seating is already the default', () => {
    localStorage.removeItem(ORDER_KEY);
    renderSeats();

    expect(
      screen.queryByRole('button', { name: 'Reset coalitions' })
    ).toBeNull();
  });

  test('offers the reset once the seating has been changed', () => {
    localStorage.setItem(
      ORDER_KEY,
      JSON.stringify(['National Party', 'Labour Party', 'Green Party'])
    );
    renderSeats();

    const reset = screen.getByRole('button', { name: 'Reset coalitions' });
    expect(reset).toHaveAttribute('title', 'Reset coalitions');
    // It sits in the heading row rather than floating over the diagram, is set
    // in the page's label face, and carries its text only from `lg` up.
    const heading = screen.getByRole('heading', { name: 'Parliament' });
    expect(reset.parentElement).toBe(heading.parentElement);
    expect(reset).not.toHaveClass('absolute');
    expect(reset).toHaveClass('font-label');
    expect(reset.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Reset coalitions')).toHaveClass(
      'hidden',
      'lg:inline'
    );
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

  test('marks each reorderable party row with a drag grip, and only those', () => {
    const results: ResultsPayload = {
      ...mockResults,
      partyVote: [
        ...mockResults.partyVote,
        {
          candidate: 'Opportunity Party',
          votes: 5000,
          seats: 0,
          electorateSeats: 0,
          listSeats: 0,
        },
      ],
    };
    renderSeats(results);

    expect(document.querySelectorAll('[data-drag-grip]')).toHaveLength(3);

    fireEvent.click(
      screen.getByRole('button', { name: /show all parties with votes/i })
    );

    // The extra row has votes but no seats, so it is not draggable and carries
    // no grip — the grip is what says a row can be moved.
    expect(document.querySelectorAll('[data-drag-grip]')).toHaveLength(3);
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
});
