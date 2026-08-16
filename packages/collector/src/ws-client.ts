import { io, Socket } from 'socket.io-client';
import type { MetricEvent, ResultsPayload } from '@election-night/core/types';
import { log } from './logger.js';
import { collectorConfig } from './config.js';
import { emitCollectorSocketConnected } from './metrics.js';
import { health } from './health.js';

let socket: Socket | null = null;
const pendingResults: ResultsPayload[] = [];
const MAX_PENDING_RESULTS = 10;
let droppedResults = 0;

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
  if (!socket?.connected) {
    log.debug('Socket.io not connected, dropping metrics event');
    return;
  }
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
    if (pendingResults.length >= MAX_PENDING_RESULTS) {
      pendingResults.shift();
      droppedResults += 1;
      log.warn(
        `Socket.io not connected; pending results queue full. Dropped ${droppedResults} result payload(s) so far.`
      );
    }
    pendingResults.push(payload);
    log.debug('Socket.io not connected, queueing results for retry');
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
