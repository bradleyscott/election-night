// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import FeedSidebar from './FeedSidebar.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockFeedEvent } from '../test/fixtures.js';
import type { FeedEvent } from '@election-night/core/types';

const older: FeedEvent = {
  ...mockFeedEvent,
  id: 'event-older',
  timestamp: mockFeedEvent.timestamp - 60_000,
  electorateName: 'Banks Peninsula',
  commentary: 'THOMAS, Alex leads Banks Peninsula at 35% counted.',
  diff: {
    ...mockFeedEvent.diff,
    electorateName: 'Banks Peninsula',
    currentPercentageCounted: 0.35,
  },
};

const newer: FeedEvent = {
  ...mockFeedEvent,
  id: 'event-newer',
  timestamp: mockFeedEvent.timestamp,
  electorateName: 'Auckland Central',
  commentary: 'SMITH, John leads Auckland Central at 95% counted.',
  diff: {
    ...mockFeedEvent.diff,
    electorateName: 'Auckland Central',
    currentPercentageCounted: 0.95,
  },
};

describe('FeedSidebar', () => {
  test('lists the newest events first, like the Feed page', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider feedEvents={[older, newer]} connected>
          <FeedSidebar />
        </MockSocketProvider>
      </BrowserRouter>
    );

    const links = screen.getAllByRole('link', {
      name: /Auckland Central|Banks Peninsula/,
    });
    expect(links.map((link) => link.textContent)).toEqual([
      'Auckland Central',
      'Banks Peninsula',
    ]);
  });

  test('shows the inline waiting state before any events arrive', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider feedEvents={[]} connected>
          <FeedSidebar />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Awaiting results')).toBeInTheDocument();
  });
});
