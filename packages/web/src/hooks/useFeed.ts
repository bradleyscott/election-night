import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { FeedEvent } from '@election-night/core/types';

const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol}//${window.location.host}`;

export function useFeed() {
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket: Socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 5000,
      reconnectionDelayMax: 120_000,
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('feed_history', (events: FeedEvent[]) => {
      setFeedEvents(events);
    });

    socket.on('feed_update', (newEvents: FeedEvent[]) => {
      setFeedEvents((prev) => [...newEvents, ...prev]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { feedEvents, connected };
}
