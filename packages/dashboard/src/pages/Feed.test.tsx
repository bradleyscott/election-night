// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Feed from './Feed.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockFeedEvent, mockFeedEvents } from '../test/fixtures.js';

describe('Feed page', () => {
  test('renders feed events when available', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider feedEvents={mockFeedEvents} connected>
          <Feed />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Auckland Central')).toBeInTheDocument();
    expect(
      screen.getByText(
        'SMITH, John leads, with about 3,000 votes still to come.'
      )
    ).toBeInTheDocument();
  });

  test('rules off each event but the last one in the feed', () => {
    // Two buckets (the page groups by 10s) so a rule has to hold across a group
    // boundary as well as inside one.
    const bucket = Math.floor(Date.now() / 10000) * 10000 - 30000;
    const events = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      ...mockFeedEvent,
      id,
      timestamp: bucket + (i < 3 ? i * 1000 : 20000 + i * 1000),
      electorateName: `Seat ${id.toUpperCase()}`,
    }));

    render(
      <BrowserRouter>
        <MockSocketProvider feedEvents={events} connected>
          <Feed />
        </MockSocketProvider>
      </BrowserRouter>
    );

    // Four rules for five events, and none above the group header or below the
    // feed's last item.
    expect(screen.getAllByRole('separator')).toHaveLength(4);
  });

  test('prints the seat chance on a finished count as well as a live one', () => {
    const complete = {
      ...mockFeedEvent,
      id: 'event-complete',
      type: 'count_completed' as const,
      probability: 0.63,
      diff: { ...mockFeedEvent.diff, currentPercentageCounted: 1 },
    };

    render(
      <BrowserRouter>
        <MockSocketProvider feedEvents={[complete]} connected>
          <Feed />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText(/100% votes counted/)).toBeInTheDocument();
    expect(screen.getByText(/63% chance of winning/)).toBeInTheDocument();
  });

  test('renders waiting state when no events are available', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider feedEvents={[]} connected={false}>
          <Feed />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });
});
