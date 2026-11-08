import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ResultsEnvelope,
  ResultsPayload,
  FeedEvent,
} from '@election-night/core/types';
import type { LatestStateRow } from '@election-night/core/history';
import { dashboardClientConfig } from '../config.js';

type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
  results: ResultsPayload | null;
  /** When this browser's `results` last changed; null before any update. */
  resultsUpdatedAt: Date | null;
  /** Committed revision of `results`, when the publisher named one. */
  resultsRevision: number | null;
  feedEvents: FeedEvent[];
};

export const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  results: null,
  resultsUpdatedAt: null,
  resultsRevision: null,
  feedEvents: [],
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [results, setResults] = useState<ResultsPayload | null>(null);
  // The latest accepted payload and its stamp, so a bootstrap response cannot
  // overwrite a newer socket delivery (or the reverse).
  const resultsRef = useRef<ResultsPayload | null>(null);
  const stampRef = useRef<number | null>(null);
  const revisionRef = useRef<number | null>(null);
  const [resultsRevision, setResultsRevision] = useState<number | null>(null);
  // When this browser last received a results payload. The server sends the
  // payload without a timestamp, and "updated 4 min ago" has to mean something
  // honest: it is when *this* visitor's copy changed.
  const [resultsUpdatedAt, setResultsUpdatedAt] = useState<Date | null>(null);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    const socket: Socket = io(dashboardClientConfig.wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 5000,
      reconnectionDelayMax: 120_000,
    });
    socketRef.current = socket;

    const applyResults = (
      payload: ResultsPayload,
      at: Date | null,
      revision: number | null
    ) => {
      // A revision is the stronger comparison when both sides have one: an
      // older revision cannot be newer merely because its HTTP response
      // arrived later than a socket frame.
      if (
        revision !== null &&
        revisionRef.current !== null &&
        revision <= revisionRef.current
      ) {
        return;
      }
      const stamp = at?.getTime() ?? Date.now();
      if (
        revision === null &&
        resultsRef.current &&
        stampRef.current !== null &&
        stamp <= stampRef.current
      ) {
        return;
      }
      resultsRef.current = payload;
      stampRef.current = stamp;
      revisionRef.current = revision ?? revisionRef.current;
      setResults(payload);
      setResultsUpdatedAt(at ?? new Date(stamp));
      setResultsRevision(revision ?? revisionRef.current);
    };

    // On start and on every reconnect, ask the collector for its durable
    // latest state. The socket server normally sends the payload on connect,
    // but a dashboard-only restart with no new feed change must still recover
    // electorates, parties and lists.
    let live = true;
    const bootstrap = async () => {
      try {
        const res = await fetch('/api/history/latest');
        if (!res.ok || !live) return;
        const latest = (await res.json()) as LatestStateRow;
        if (!latest?.payload || !live) return;
        const at = latest.updatedAt ? new Date(latest.updatedAt) : null;
        applyResults(latest.payload, at, latest.revision ?? null);
      } catch {
        // No durable state yet, or the collector is unreachable: the socket
        // payload (when it arrives) is still authoritative for this session.
      }
    };
    void bootstrap();

    const onConnect = () => {
      setConnected(true);
      void bootstrap();
    };
    const onDisconnect = () => setConnected(false);
    const onResultsUpdate = (data: ResultsEnvelope | ResultsPayload) => {
      const envelope: ResultsEnvelope =
        data && typeof data === 'object' && 'payload' in data
          ? (data as ResultsEnvelope)
          : {
              payload: data as ResultsPayload,
              electionYear: null,
              revision: null,
            };
      applyResults(envelope.payload, new Date(), envelope.revision ?? null);
    };
    const onFeedHistory = (events: FeedEvent[]) => setFeedEvents(events);
    const onFeedUpdate = (newEvents: FeedEvent[]) =>
      setFeedEvents((prev) => [...newEvents, ...prev]);
    const onClear = () => {
      resultsRef.current = null;
      stampRef.current = null;
      revisionRef.current = null;
      setResults(null);
      setResultsUpdatedAt(null);
      setResultsRevision(null);
      setFeedEvents([]);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('results_update', onResultsUpdate);
    socket.on('feed_history', onFeedHistory);
    socket.on('feed_update', onFeedUpdate);
    socket.on('clear', onClear);

    return () => {
      live = false;
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
      value={{
        socket: socketRef.current,
        connected,
        results,
        resultsUpdatedAt,
        resultsRevision,
        feedEvents,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
