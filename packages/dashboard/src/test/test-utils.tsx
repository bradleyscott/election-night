import { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SocketContext } from '../context/SocketProvider.js';
import type { ResultsPayload, FeedEvent } from '@election-night/core/types';

export function MockSocketProvider({
  children,
  results = null,
  feedEvents = [],
  connected = true,
}: {
  children: ReactNode;
  results?: ResultsPayload | null;
  feedEvents?: FeedEvent[];
  connected?: boolean;
}) {
  return (
    <SocketContext.Provider
      value={{ socket: null, connected, results, feedEvents }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function renderWithProviders(children: ReactNode) {
  return (
    <BrowserRouter>
      <MockSocketProvider>{children}</MockSocketProvider>
    </BrowserRouter>
  );
}

export function renderWithProvidersAndData(
  children: ReactNode,
  data: { results?: ResultsPayload | null; feedEvents?: FeedEvent[]; connected?: boolean }
) {
  return (
    <BrowserRouter>
      <MockSocketProvider {...data}>{children}</MockSocketProvider>
    </BrowserRouter>
  );
}
