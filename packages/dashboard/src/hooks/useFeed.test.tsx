// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFeed } from './useFeed.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockFeedEvents } from '../test/fixtures.js';

function TestComponent() {
  const { feedEvents, connected } = useFeed();
  return (
    <div>
      <div data-testid="connected">{connected ? 'connected' : 'disconnected'}</div>
      <div data-testid="events">{feedEvents.length}</div>
    </div>
  );
}

describe('useFeed', () => {
  test('returns feed events from SocketContext', () => {
    render(
      <MockSocketProvider feedEvents={mockFeedEvents} connected>
        <TestComponent />
      </MockSocketProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('connected');
    expect(screen.getByTestId('events')).toHaveTextContent('1');
  });

  test('returns zero events when context has none', () => {
    render(
      <MockSocketProvider feedEvents={[]} connected={false}>
        <TestComponent />
      </MockSocketProvider>
    );

    expect(screen.getByTestId('events')).toHaveTextContent('0');
  });
});
