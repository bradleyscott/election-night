import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ResultsPayload, FeedEvent } from '@election-night/core/types';
import { dashboardClientConfig } from '../config.js';

type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
  results: ResultsPayload | null;
  feedEvents: FeedEvent[];
};

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  results: null,
  feedEvents: [],
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    const socket: Socket = io(dashboardClientConfig.wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 5000,
      reconnectionDelayMax: 120_000,
    });
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onResultsUpdate = (payload: ResultsPayload) => setResults(payload);
    const onFeedHistory = (events: FeedEvent[]) => setFeedEvents(events);
    const onFeedUpdate = (newEvents: FeedEvent[]) =>
      setFeedEvents((prev) => [...newEvents, ...prev]);
    const onClear = () => {
      setResults(null);
      setFeedEvents([]);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('results_update', onResultsUpdate);
    socket.on('feed_history', onFeedHistory);
    socket.on('feed_update', onFeedUpdate);
    socket.on('clear', onClear);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('results_update', onResultsUpdate);
      socket.off('feed_history', onFeedHistory);
      socket.off('feed_update', onFeedUpdate);
      socket.off('clear', onClear);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return (
    <SocketContext.Provider
      value={{ socket: socketRef.current, connected, results, feedEvents }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
