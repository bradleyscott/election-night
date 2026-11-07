// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  test('opens a seat beside the circle that was clicked', async () => {
    renderSeats();

    const seat = screen.getAllByRole('button', {
      name: /electorate seat/i,
    })[0];
    fireEvent.click(seat);

    const popover = await waitFor(() =>
      screen.getByRole('dialog', { name: /seat$/ })
    );
    // Anchored to the seat, not parked in a corner: a fixed box in the body
    // whose offset is carried by `left`/`top`. A transform here would be
    // overwritten by the element's own fade animation, which is what put it
    // top-left.
    expect(popover).toHaveStyle({ position: 'fixed' });
    expect(popover.parentElement).toBe(document.body);
    expect(popover.style.transform).toBe('');
    expect(popover.style.left).not.toBe('');
    expect(popover.style.top).not.toBe('');
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
