import { io, Socket } from 'socket.io-client';
import type { ResultsPayload } from '@election-night/core/types';
import { log } from './logger.js';

const WS_RECONNECT_DELAY_MS = parseInt(
  process.env.WS_RECONNECT_DELAY_MS || '2000',
  10
);

let socket: Socket | null = null;

export function connectWs(url: string) {
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: WS_RECONNECT_DELAY_MS,
    reconnectionDelayMax: 30_000,
  });

  socket.on('connect', () => {
    log.info(`Connected to socket.io server at ${url}`);
  });

  socket.on('connect_error', (err) => {
    log.warn(`Socket.io connection failed: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    log.warn(`Socket.io disconnected: ${reason}`);
  });
}

export function publishResults(payload: ResultsPayload) {
  if (!socket?.connected) {
    log.debug('Socket.io not connected, skipping publish');
    return;
  }

  socket.emit('results_update', payload);
  log.info('Published results via socket.io');
}

export function disconnectWs() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
