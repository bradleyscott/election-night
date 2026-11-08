// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { io } from 'socket.io-client';
import { SocketProvider, useSocket } from './SocketProvider.js';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));

type Handler = (...args: unknown[]) => void;

function fakeSocket() {
  const handlers = new Map<string, Set<Handler>>();
  const socket = {
    connected: true,
    on(event: string, handler: Handler) {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      return socket;
    },
    off(event: string, handler: Handler) {
      handlers.get(event)?.delete(handler);
      return socket;
    },
    disconnect() {},
  };
  return {
    socket,
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
}

function Probe() {
  const { results, connected } = useSocket();
  return (
    <div>
      <div data-testid="seats">{results?.electorateResults.length ?? 0}</div>
      <div data-testid="parties">{results?.partyVote.length ?? 0}</div>
      <div data-testid="lists">{results?.partyLists.length ?? 0}</div>
      <div data-testid="connected">{connected ? 'yes' : 'no'}</div>
    </div>
  );
}

const LATEST = {
  electionYear: '2026',
  revision: 3,
  payload: {
    electorateResults: [{ electorateName: 'Auckland Central' }],
    partyVote: [{ candidate: 'National Party', votes: 1 }],
    partyLists: [{ party: 'National Party', candidate: 'A', listRank: 1 }],
  },
  source: 'NZ Election XML Feed',
  observedAt: '2026-11-07T07:00:00.000Z',
  phase: 'counting',
  coverage: null,
  modelVersion: 1,
  configVersion: '2026',
  updatedAt: '2026-11-07T07:00:01.000Z',
};

describe('SocketProvider durable bootstrap', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(LATEST), { status: 200 }))
    );
    vi.mocked(io).mockReturnValue(fakeSocket().socket as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(io).mockReset();
  });

  test('recovers all three collections from the latest-state endpoint on start', async () => {
    const fake = fakeSocket();
    vi.mocked(io).mockReturnValue(fake.socket as never);

    render(
      <SocketProvider>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('seats')).toHaveTextContent('1')
    );
    expect(screen.getByTestId('parties')).toHaveTextContent('1');
    // Lists too: a dashboard restart with the feed down must not lose them.
    expect(screen.getByTestId('lists')).toHaveTextContent('1');
    expect(fetch).toHaveBeenCalledWith('/api/history/latest');
  });

  test('re-reads the latest state on a reconnect', async () => {
    const fake = fakeSocket();
    vi.mocked(io).mockReturnValue(fake.socket as never);

    render(
      <SocketProvider>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('seats')).toHaveTextContent('1')
    );
    const before = vi.mocked(fetch).mock.calls.length;

    fake.emit('connect');
    await waitFor(() =>
      expect(screen.getByTestId('connected')).toHaveTextContent('yes')
    );
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before);
  });

  test('a clear event empties the durable state too', async () => {
    const fake = fakeSocket();
    vi.mocked(io).mockReturnValue(fake.socket as never);

    render(
      <SocketProvider>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('seats')).toHaveTextContent('1')
    );

    fake.emit('clear');
    await waitFor(() =>
      expect(screen.getByTestId('seats')).toHaveTextContent('0')
    );
    expect(screen.getByTestId('lists')).toHaveTextContent('0');
  });
});
