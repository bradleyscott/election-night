// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Feed from './Feed.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockFeedEvents } from '../test/fixtures.js';

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
    expect(screen.getByText(/SMITH, John leads by 4.00%/)).toBeInTheDocument();
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
