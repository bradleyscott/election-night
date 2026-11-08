// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocketContext } from '../context/SocketProvider.js';
import { useElectorateHistory, usePartyVoteHistory } from './useVoteHistory.js';
import { useHistorySocketSync } from '../lib/history-api.js';

const CONFIG = {
  electionYear: '2026',
  pollsCloseAt: null,
  serverTime: '2026-11-07T07:00:00.000Z',
};

type Row = {
  snapshotId: number;
  startedAt: string;
};

function row(snapshotId: number): Row {
  return {
    snapshotId,
    startedAt: `2026-11-07T07:${String(snapshotId).padStart(2, '0')}:00.000Z`,
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function Sync() {
  useHistorySocketSync();
  return null;
}

function Probe({ electorate }: { electorate: string | null }) {
  const { data, state } = useElectorateHistory(electorate);
  return (
    <div>
      <div data-testid="state">{state}</div>
      <div data-testid="count">{data?.length ?? 0}</div>
      <div data-testid="first">{data?.[0]?.snapshotId ?? 'none'}</div>
    </div>
  );
}

function PartyProbe() {
  const { data, state } = usePartyVoteHistory();
  return (
    <div>
      <div data-testid="state">{state}</div>
      <div data-testid="count">{data?.length ?? 0}</div>
      <div data-testid="ids">{data?.map((p) => p.snapshotId).join(',')}</div>
    </div>
  );
}

function ui(
  client: QueryClient,
  children: ReactNode,
  updatedAt: Date | null = null,
  connected = true,
  revision: number | null = null
) {
  return (
    <QueryClientProvider client={client}>
      <SocketContext.Provider
        value={{
          socket: null,
          connected,
          results: null,
          resultsUpdatedAt: updatedAt,
          resultsRevision: revision,
          feedEvents: [],
        }}
      >
        {children}
      </SocketContext.Provider>
    </QueryClientProvider>
  );
}

/** Stub config plus a handler for every non-config URL. */
function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config') return json(CONFIG);
    return handler(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock as unknown as ReturnType<typeof vi.fn>;
}

describe('history queries', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('shares one request between two consumers of the same seat', async () => {
    const mock = stubFetch(() => json([row(1)]));
    const client = makeClient();

    render(
      ui(
        client,
        <>
          <Probe electorate="Mt Roskill" />
          <Probe electorate="Mt Roskill" />
        </>
      )
    );

    await waitFor(() =>
      expect(screen.getAllByTestId('count')[0]).toHaveTextContent('1')
    );
    const historyCalls = mock.mock.calls.filter(([url]) =>
      String(url).includes('/history/electorate/')
    );
    expect(historyCalls).toHaveLength(1);
  });

  test('refetches when a live results update arrives, and not when it does not', async () => {
    const mock = stubFetch(() => json([row(1)]));
    const client = makeClient();

    const { rerender } = render(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>,
        new Date(1_000)
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    );
    const calls = () =>
      mock.mock.calls.filter(([url]) =>
        String(url).includes('/history/electorate/')
      ).length;

    // A rerender with the same instant is not a new notification.
    rerender(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>,
        new Date(1_000)
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls()).toBe(1);

    // A new instant invalidates the active query.
    rerender(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>,
        new Date(2_000)
      )
    );
    await waitFor(() => expect(calls()).toBe(2));
  });

  test('keeps the same seat data when the last refresh fails and reports stale', async () => {
    let fail = false;
    stubFetch(() => {
      if (fail) return Promise.reject(new Error('connection refused'));
      return json([row(1), row(2)]);
    });
    const client = makeClient();

    const { rerender } = render(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    );

    fail = true;
    rerender(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>,
        new Date(5_000)
      )
    );

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('stale')
    );
    // The rows stay: a failed refresh is not an empty night.
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  test('does not mark a response older than the last notification caught up', async () => {
    stubFetch(() =>
      json([row(1)], {
        headers: {
          'x-election-history-state': 'verified',
          'x-election-revision': '1',
        },
      })
    );
    const client = makeClient();

    // The socket has already accepted revision 5; this body is revision 1.
    render(ui(client, <Probe electorate="Mt Roskill" />, null, true, 5));

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('stale')
    );
    // The rows remain; the next poll is the recovery path.
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  test('surfaces a stale proxy answer even on a 200', async () => {
    stubFetch(() =>
      json([row(1)], {
        headers: {
          'x-election-history-state': 'stale',
          'x-election-history-verified-at': '2026-11-07T07:00:00.000Z',
          'x-election-history-reason': 'upstream-unreachable',
        },
      })
    );
    const client = makeClient();

    render(ui(client, <Probe electorate="Mt Roskill" />));

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('stale')
    );
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  test('never shows one seat under another seat while the new one loads', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    let aStarted = false;
    stubFetch((url) => {
      if (url.includes('/electorate/Seat%20A')) {
        aStarted = true;
        return a.promise;
      }
      if (url.includes('/electorate/Seat%20B')) return b.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const client = makeClient();

    const { rerender } = render(ui(client, <Probe electorate="Seat A" />));
    await waitFor(() => expect(aStarted).toBe(true));

    rerender(ui(client, <Probe electorate="Seat B" />));
    expect(screen.getByTestId('state')).toHaveTextContent('loading');
    expect(screen.getByTestId('first')).toHaveTextContent('none');

    // Seat A's response arriving late must not appear under Seat B's name.
    a.resolve(json([row(11)]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('first')).toHaveTextContent('none');

    b.resolve(json([row(22)]));
    await waitFor(() =>
      expect(screen.getByTestId('first')).toHaveTextContent('22')
    );
  });

  test('merges a multi-page window by snapshot id and in time order', async () => {
    stubFetch((url) => {
      if (url === '/api/history/party-votes') {
        return json(
          {
            error: 'history window exceeds the maximum page size',
            total: 5,
            limit: 2,
          },
          { status: 413 }
        );
      }
      const parsed = new URL(url, 'http://localhost');
      const offset = Number(parsed.searchParams.get('offset'));
      // Overlapping pages, deliberately out of order.
      if (offset === 0) return json([row(2), row(1)]);
      if (offset === 2) return json([row(3), row(2)]);
      return json([row(5), row(4)]);
    });
    const client = makeClient();

    render(ui(client, <PartyProbe />));

    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('5')
    );
    expect(screen.getByTestId('ids')).toHaveTextContent('1,2,3,4,5');
  });

  test('does not fetch history while no electorate is selected', async () => {
    const mock = stubFetch(() => json([]));
    const client = makeClient();

    render(ui(client, <Probe electorate={null} />));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      mock.mock.calls.filter(([url]) =>
        String(url).includes('/history/electorate')
      )
    ).toHaveLength(0);
  });

  test('refetches on a socket reconnect, not only on a results payload', async () => {
    const mock = stubFetch(() => json([row(1)]));
    const client = makeClient();

    const { rerender } = render(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    );

    rerender(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>,
        null,
        false
      )
    );
    rerender(
      ui(
        client,
        <>
          <Sync />
          <Probe electorate="Mt Roskill" />
        </>,
        null,
        true
      )
    );

    await waitFor(() =>
      expect(
        mock.mock.calls.filter(([url]) =>
          String(url).includes('/history/electorate/')
        )
      ).toHaveLength(2)
    );
  });
});
