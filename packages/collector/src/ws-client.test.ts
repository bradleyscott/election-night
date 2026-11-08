import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type { ResultsPayload } from '@election-night/core/types';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Handler = (...args: unknown[]) => void;

const handlers = new Map<string, Handler>();
const mockSocket = {
  connected: true,
  on: vi.fn((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return mockSocket;
  }),
  emit: vi.fn(),
  timeout: vi.fn(() => mockSocket),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

function connectHandler(): Handler {
  return handlers.get('connect')!;
}

describe('ws-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockSocket.connected = true;
    mockSocket.timeout.mockReturnValue(mockSocket);
    // Acknowledge immediately by default, which also clears the in-flight flag.
    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, ack?: Handler) => {
        if (typeof ack === 'function') ack(null, { ok: true });
      }
    );
  });

  afterEach(async () => {
    const { disconnectWs } = await import('./ws-client.js');
    disconnectWs();
  });

  test('connectWs creates a socket connection', async () => {
    const { connectWs } = await import('./ws-client.js');
    const { io } = await import('socket.io-client');

    connectWs('ws://localhost:3456');

    expect(io).toHaveBeenCalledWith(
      'ws://localhost:3456',
      expect.objectContaining({
        reconnection: true,
      })
    );
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith(
      'connect_error',
      expect.any(Function)
    );
    expect(mockSocket.on).toHaveBeenCalledWith(
      'disconnect',
      expect.any(Function)
    );
  });

  test('publishResults emits a revisioned envelope and awaits the ack', async () => {
    const { connectWs, publishResults } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');

    const payload = {
      electorateResults: [{ electorateName: 'Test', votesCounted: 100 }],
      partyVote: [],
      partyLists: [],
    } as unknown as ResultsPayload;

    publishResults(payload, 7);

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'results_update',
      expect.objectContaining({ payload, revision: 7 }),
      expect.any(Function)
    );
  });

  test('publishResults holds the latest state while disconnected', async () => {
    const { publishResults, connectWs } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');

    const first = {
      electorateResults: [{ electorateName: 'First' }],
      partyVote: [],
      partyLists: [],
    } as unknown as ResultsPayload;
    const second = {
      electorateResults: [{ electorateName: 'Second' }],
      partyVote: [],
      partyLists: [],
    } as unknown as ResultsPayload;

    mockSocket.connected = false;
    publishResults(first, 1);
    publishResults(second, 2);
    expect(mockSocket.emit).not.toHaveBeenCalled();

    mockSocket.connected = true;
    mockSocket.emit.mockClear();
    connectHandler()();

    // One fact, not two obsolete payloads. The connect handler also publishes
    // a metrics heartbeat, so count only results.
    const resultEmits = mockSocket.emit.mock.calls.filter(
      ([event]) => event === 'results_update'
    );
    expect(resultEmits).toHaveLength(1);
    const envelope = resultEmits[0]![1] as {
      payload: ResultsPayload;
      revision: number;
    };
    expect(envelope.payload).toBe(second);
    expect(envelope.revision).toBe(2);
  });

  test('resends the latest state on reconnect even with no new facts', async () => {
    const { connectWs, publishResults } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');

    const payload = {
      electorateResults: [],
      partyVote: [],
      partyLists: [],
    };
    publishResults(payload, 3);
    mockSocket.emit.mockClear();

    connectHandler()();

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'results_update',
      expect.objectContaining({ revision: 3 }),
      expect.any(Function)
    );
  });

  test('retries a lost acknowledgement a bounded number of times', async () => {
    vi.useFakeTimers();
    const { connectWs, publishResults } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');
    mockSocket.emit.mockImplementation(
      (event: string, payload: unknown, ack?: Handler) => {
        if (typeof ack === 'function') ack(new Error('timeout'));
      }
    );

    publishResults({ electorateResults: [], partyVote: [], partyLists: [] }, 1);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockSocket.emit).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  test('disconnectWs disconnects the socket', async () => {
    const { connectWs, disconnectWs } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');

    disconnectWs();

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});
