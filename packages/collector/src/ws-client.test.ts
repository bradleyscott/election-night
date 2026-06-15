import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type { ResultsPayload } from '@election-night/core/types';

vi.mock('./logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockSocket = {
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

describe('ws-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  test('publishResults emits results_update when connected', async () => {
    const { connectWs, publishResults } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');

    const payload = {
      electorateResults: [{ electorateName: 'Test', votesCounted: 100 }],
      partyVote: [],
      partyLists: [],
    } as unknown as ResultsPayload;

    publishResults(payload);

    expect(mockSocket.emit).toHaveBeenCalledWith('results_update', payload);
  });

  test('publishResults skips when not connected', async () => {
    const { publishResults } = await import('./ws-client.js');

    const payload = {
      electorateResults: [],
      partyVote: [],
      partyLists: [],
    };

    publishResults(payload);

    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  test('disconnectWs disconnects the socket', async () => {
    const { connectWs, disconnectWs } = await import('./ws-client.js');
    connectWs('ws://localhost:3456');

    disconnectWs();

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});
