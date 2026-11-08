// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VotingPlacesResponse } from '@election-night/core/voting-places';
import { useVotingPlaces, votingPlacesRefetchMs } from './useVotingPlaces.js';

const CONFIG = {
  electionYear: '2026',
  pollsCloseAt: null,
  serverTime: '2026-11-07T07:00:00.000Z',
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function places(counted: 'none' | 'one' | 'all'): VotingPlacesResponse {
  const first = counted !== 'none';
  const second = counted === 'all';
  return {
    electorateName: 'Mt Roskill',
    year: '2026',
    available: true,
    reason: null,
    counted: Number(first) + Number(second),
    total: 2,
    places: [
      {
        id: 1,
        name: 'Booth One',
        address: '',
        lat: null,
        lon: null,
        electorateName: 'Mt Roskill',
        group: 'seat',
        countedAt: first ? '2026-11-07T19:00:00' : null,
      },
      {
        id: 2,
        name: 'Booth Two',
        address: '',
        lat: null,
        lon: null,
        electorateName: 'Mt Roskill',
        group: 'seat',
        countedAt: second ? '2026-11-07T19:05:00' : null,
      },
    ],
  };
}

function stubFetch(
  handler: (url: string) => Promise<Response> | Response
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return json(CONFIG);
      return handler(url);
    })
  );
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function Probe() {
  const { summary, loading, error, refetch } = useVotingPlaces('Mt Roskill');
  return (
    <div>
      <div data-testid="summary">
        {summary ? `${summary.counted}/${summary.total}` : 'none'}
      </div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="error">{error ?? 'none'}</div>
      <button onClick={refetch}>Retry</button>
    </div>
  );
}

function ui(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
}

describe('useVotingPlaces', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('recovers on retry after an initial failure', async () => {
    let healthy = false;
    stubFetch(() =>
      healthy
        ? json(places('one'))
        : json({ error: 'query failed' }, { status: 500 })
    );
    const client = makeClient();

    render(ui(client));
    await waitFor(() =>
      expect(screen.getByTestId('error')).not.toHaveTextContent('none')
    );
    expect(screen.getByTestId('summary')).toHaveTextContent('none');

    healthy = true;
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() =>
      expect(screen.getByTestId('summary')).toHaveTextContent('1/2')
    );
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  test('a failed first request does not stop the polling policy', () => {
    // No answer yet (the first request failed): the next tick must still ask.
    expect(votingPlacesRefetchMs(undefined)).toBe(60_000);
    // Still counting: one minute.
    expect(votingPlacesRefetchMs(places('none'))).toBe(60_000);
    // Complete: slower, but never off, because corrections still arrive.
    expect(votingPlacesRefetchMs(places('all'))).toBe(300_000);
    // A cycle with no place listing will never have one; do not ask again.
    expect(votingPlacesRefetchMs({ ...places('all'), available: false })).toBe(
      false
    );
  });
});
