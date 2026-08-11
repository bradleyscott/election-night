import { io, Socket } from 'socket.io-client';
import type { MetricEvent, ResultsPayload } from '@election-night/core/types';
import { log } from './logger.js';
import { collectorConfig } from './config.js';
import { emitCollectorSocketConnected } from './metrics.js';
import { health } from './health.js';

let socket: Socket | null = null;
const pendingResults: ResultsPayload[] = [];

function flushPending() {
  if (!socket?.connected) return;
  while (pendingResults.length > 0) {
    const payload = pendingResults.shift();
    if (payload) {
      socket.emit('results_update', payload);
    }
  }
}

export function publishMetrics(events: MetricEvent | MetricEvent[]) {
  if (!socket?.connected) return;
  socket.emit('metrics', events);
}

export function connectWs(url: string) {
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: collectorConfig.wsReconnectDelayMs,
    reconnectionDelayMax: 30_000,
  });

  socket.on('connect', () => {
    log.info(`Connected to socket.io server at ${url}`);
    health.socketConnected = true;
    health.socketUrl = url;
    publishMetrics(emitCollectorSocketConnected(true));
    flushPending();
  });

  socket.on('connect_error', (err) => {
    log.warn(`Socket.io connection failed: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    log.warn(`Socket.io disconnected: ${reason}`);
    health.socketConnected = false;
  });
}

export function publishResults(payload: ResultsPayload) {
  if (!socket?.connected) {
    log.debug('Socket.io not connected, queueing results for retry');
    pendingResults.push(payload);
    return;
  }

  socket.emit('results_update', payload);
  health.lastPublishAt = Date.now();
  log.info('Published results via socket.io');
}

export function disconnectWs() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
