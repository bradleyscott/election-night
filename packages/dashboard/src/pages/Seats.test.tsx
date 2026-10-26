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

    // 25,000 votes at 55% turnout implies 45,455 enrolled, so tonight's count
    // is about 27,660 votes and this is 90% of it. The 95% the feed reports is
    // the share of *voting places* reported, which is a different question.
    expect(screen.getByText('25,000')).toBeInTheDocument();
    expect(screen.getByText('90.4%')).toBeInTheDocument();
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
    // than claimed as a certainty. What matters is that the column states a
    // chance at all: the ± margin-of-error suffix is gone from the table.
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.queryByText(/±/)).toBeNull();
  });

  test('states the margin a finished count produced, not a probability', () => {
    // Votes past the roll's expected night total put the count over the
    // model's completion threshold, which is what a finished seat looks like.
    const complete = {
      ...mockResults,
      electorateResults: mockResults.electorateResults.map((er) => ({
        ...er,
        votesCounted: 30_000,
        percentVotesCast: 0.7,
      })),
    };

    const { container } = render(
      <BrowserRouter>
        <MockSocketProvider results={complete} connected>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    // The fixture's lead is 4% of the votes counted, and a finished count has
    // no probability left to quote.
    expect(container.textContent).toMatch(/4\.0%\s*margin/);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText('Certainty')).toBeInTheDocument();
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
