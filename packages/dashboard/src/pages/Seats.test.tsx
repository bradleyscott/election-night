// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Seats from './Seats.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockResults } from '../test/fixtures.js';

describe('Seats page', () => {
  test('renders seat totals when results are available', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider results={mockResults} connected>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Total Seats')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.getByText('Parties in Parliament')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('shows the votes counted and how far through tonight the count is', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider results={mockResults} connected>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

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

  test('shows a seat candidate a chance of winning, not a margin and its error', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider results={mockResults} connected>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    // The fixture has no prior on file, so the chance is capped at 95% rather
    // than claimed as a certainty — and the special vote now sits inside the
    // number, so it lands below the cap. What matters is that the column states
    // a chance at all: the ± margin-of-error suffix is gone from the table.
    expect(screen.getAllByText(/^\d+%$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText(/±/)).toBeNull();
  });

  test('keeps the chance for a finished count, because the specials are still out', () => {
    // A seat finishes when every one of its places has reported, which is the
    // fact the model completes on — not when the turnout estimate runs out.
    const complete = {
      ...mockResults,
      electorateResults: mockResults.electorateResults.map((er) => ({
        ...er,
        votesCounted: 30_000,
        percentVotesCast: 0.7,
        votePercentageCounted: 1,
      })),
    };

    const { container } = render(
      <BrowserRouter>
        <MockSocketProvider results={complete} connected>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    // The column sorts on a chance, so it prints one: a finished count keeps the
    // number and never claims 100%, because the special vote is still to come.
    expect(screen.getByText('Certainty')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/%\s*margin/);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getAllByText(/^\d+%$/).length).toBeGreaterThan(0);
  });

  test('renders waiting state when no results are available', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider results={null} connected={false}>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });
});
