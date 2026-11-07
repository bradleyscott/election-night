// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SocketContext } from '../context/SocketProvider.js';
import { useElectorateHistory } from './useVoteHistory.js';

function HistoryProbe({ electorate }: { electorate: string | null }) {
  const { data } = useElectorateHistory(electorate);
  return <div data-testid="points">{data?.length ?? 0}</div>;
}

function withResults(
  updatedAt: Date | null,
  electorate: string | null = 'Mt Roskill'
) {
  return (
    <SocketContext.Provider
      value={{
        socket: null,
        connected: true,
        results: null,
        resultsUpdatedAt: updatedAt,
        feedEvents: [],
      }}
    >
      <HistoryProbe electorate={electorate} />
    </SocketContext.Provider>
  );
}

describe('useElectorateHistory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('refetches when a live results update arrives', async () => {
    // The history route is fed by the collector, not by the socket payload,
    // so without this the chart keeps the snapshot it loaded while the table
    // beside it moves on.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ time: '20:00' }]), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ time: '20:00' }, { time: '21:00' }]), {
          status: 200,
        })
      );

    const { rerender } = render(withResults(null));
    await waitFor(() =>
      expect(screen.getByTestId('points')).toHaveTextContent('1')
    );

    rerender(withResults(new Date(1_000)));
    await waitFor(() =>
      expect(screen.getByTestId('points')).toHaveTextContent('2')
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('does not fetch while no electorate is selected', () => {
    render(withResults(new Date(1_000), null));
    expect(fetch).not.toHaveBeenCalled();
  });
});
