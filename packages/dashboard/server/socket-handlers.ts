import type { Server as SocketServer } from 'socket.io';
import type {
  MetricEvent,
  ResultsPayload,
  FeedEvent,
} from '@election-night/core/types';
import { log } from './logger.js';
import {
  applyMetricEvents,
  websocketClients,
  lastScrapeTimestampSeconds,
} from './metrics.js';

type ElectorateResult = NonNullable<
  ResultsPayload['electorateResults']
>[number];

export type SocketHandlerDeps = {
  latestResults: { current: ResultsPayload | null };
  getFeedEvents: () => FeedEvent[];
  buildFeedEvents: (
    previous: ElectorateResult[],
    current: ElectorateResult[]
  ) => FeedEvent[];
  addFeedEvents: (events: FeedEvent[]) => FeedEvent[];
};

export function attachSocketHandlers(
  io: SocketServer,
  deps: SocketHandlerDeps
): void {
  io.on('connection', (socket) => {
    log.info(`Client connected: ${socket.id}`);
    websocketClients.set(io.engine.clientsCount);

    if (deps.latestResults.current) {
      socket.emit('results_update', deps.latestResults.current);
    }

    const feedEvents = deps.getFeedEvents();
    if (feedEvents.length > 0) {
      socket.emit('feed_history', feedEvents);
    }

    socket.on('results_update', (payload: ResultsPayload) => {
      const previousResults =
        deps.latestResults.current?.electorateResults ?? [];
      deps.latestResults.current = payload;
      lastScrapeTimestampSeconds.set(Date.now() / 1000);
      log.info('Received results update, broadcasting...');
      socket.broadcast.emit('results_update', payload);

      const rawEvents = deps.buildFeedEvents(
        previousResults,
        payload.electorateResults
      );
      if (rawEvents.length === 0) return;

      const newEvents = deps.addFeedEvents(rawEvents);
      if (newEvents.length > 0) {
        log.info(`Generated ${newEvents.length} feed events`);
        io.emit('feed_update', newEvents);
      }
    });

    socket.on('disconnect', () => {
      log.info(`Client disconnected: ${socket.id}`);
      websocketClients.set(io.engine.clientsCount);
    });

    socket.on('metrics', (events: MetricEvent | MetricEvent[]) => {
      applyMetricEvents(events);
    });
  });
}
