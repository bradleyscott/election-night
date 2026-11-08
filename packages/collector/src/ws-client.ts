import { io, Socket } from 'socket.io-client';
import type {
  MetricEvent,
  ResultsEnvelope,
  ResultsPayload,
} from '@election-night/core/types';
import { log } from './logger.js';
import { collectorConfig } from './config.js';
import { emitCollectorSocketConnected } from './metrics.js';
import { health } from './health.js';

let socket: Socket | null = null;
/**
 * The latest committed envelope, not a queue of payloads. A disconnected
 * interval of ten updates leaves one fact to send, not ten obsolete ones.
 */
let latestEnvelope: ResultsEnvelope | null = null;
let sending = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const SEND_TIMEOUT_MS = 5_000;
const MAX_SEND_ATTEMPTS = 3;

type PublishAck = {
  ok?: boolean;
  duplicate?: boolean;
  revision?: number | null;
  error?: string;
};

function sendLatest() {
  if (!socket?.connected || !latestEnvelope || sending) return;
  const envelope = latestEnvelope;
  sending = true;
  const sentAttempt = attempts;
  socket
    .timeout(SEND_TIMEOUT_MS)
    .emit('results_update', envelope, (err: Error | null, ack?: PublishAck) => {
      sending = false;
      if (!err && ack?.ok) {
        attempts = 0;
        health.lastPublishAt = Date.now();
        log.info(
          ack.duplicate
            ? `Published results revision ${envelope.revision ?? 'legacy'} (already accepted)`
            : `Published results revision ${envelope.revision ?? 'legacy'} via socket.io`
        );
        // A newer publication may have arrived while this ack was in flight.
        if (latestEnvelope !== envelope) sendLatest();
        return;
      }

      attempts += 1;
      const detail = err?.message ?? ack?.error ?? 'no acknowledgement';
      if (attempts >= MAX_SEND_ATTEMPTS) {
        log.warn(
          `Results revision ${envelope.revision ?? 'legacy'} was not acknowledged after ${attempts} attempts (${detail}); keeping the latest state for the next reconnect`
        );
        return;
      }
      log.warn(
        `Results revision ${envelope.revision ?? 'legacy'} not acknowledged (${detail}); retrying`
      );
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(sendLatest, 1_000 * 2 ** sentAttempt);
      retryTimer.unref?.();
    });
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
    // A split deployment's server requires this when ALLOW_REMOTE_RESULTS is
    // on; the combined image leaves it unset and publishes over loopback.
    auth: collectorConfig.resultsToken
      ? { token: collectorConfig.resultsToken }
      : undefined,
  });

  socket.on('connect', () => {
    log.info(`Connected to socket.io server at ${url}`);
    health.socketConnected = true;
    health.socketUrl = url;
    publishMetrics(emitCollectorSocketConnected(true));
    // Reconcile on every connect, even when no new facts arrived: a
    // dashboard-only restart may have missed the last publish.
    attempts = 0;
    sendLatest();
  });

  socket.on('connect_error', (err) => {
    log.warn(`Socket.io connection failed: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    log.warn(`Socket.io disconnected: ${reason}`);
    health.socketConnected = false;
    // Record locally — the socket is down, so there is nothing to publish to.
    emitCollectorSocketConnected(false);
  });
}

export function publishResults(
  payload: ResultsPayload,
  revision: number | null = null
) {
  latestEnvelope = {
    payload,
    electionYear: collectorConfig.electionYear,
    revision,
  };
  if (!socket?.connected) {
    log.debug(
      'Socket.io not connected, holding the latest results for reconnect'
    );
    return;
  }
  attempts = 0;
  sendLatest();
}

export function disconnectWs() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
