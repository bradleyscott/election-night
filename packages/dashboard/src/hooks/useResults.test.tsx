// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useResults } from './useResults.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockResults } from '../test/fixtures.js';

function TestComponent() {
  const { results, connected } = useResults();
  return (
    <div>
      <div data-testid="connected">{connected ? 'connected' : 'disconnected'}</div>
      <div data-testid="electorates">{results?.electorateResults.length ?? 0}</div>
    </div>
  );
}

describe('useResults', () => {
  test('returns connected status and results from SocketContext', () => {
    render(
      <MockSocketProvider results={mockResults} connected>
        <TestComponent />
      </MockSocketProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('connected');
    expect(screen.getByTestId('electorates')).toHaveTextContent('1');
  });

  test('returns disconnected when context reports disconnected', () => {
    render(
      <MockSocketProvider results={null} connected={false}>
        <TestComponent />
      </MockSocketProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('disconnected');
    expect(screen.getByTestId('electorates')).toHaveTextContent('0');
  });
});
