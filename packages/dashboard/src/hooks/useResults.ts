import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ResultsPayload } from '@election-night/core/types';

const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol}//${window.location.host}`;

export function useResults() {
  const [results, setResults] = useState<ResultsPayload | null>(null);
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

    socket.on('results_update', (payload: ResultsPayload) => {
      setResults(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { results, connected };
}
