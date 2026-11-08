import { QueryClient } from '@tanstack/react-query';

/**
 * How often an active history query re-reads while the page is visible.
 *
 * The proxy caches a verified answer for 10s, so a socket notification may
 * still read the same body; 30s polling is what guarantees eventual catch-up
 * even when a notification and the proxy TTL overlap. React Query pauses the
 * interval while the tab is hidden and refetches on focus/reconnect.
 */
export const HISTORY_POLL_MS = 30_000;

/** Treat a response as fresh for the proxy's own 10s window. */
export const HISTORY_STALE_TIME_MS = 10_000;

/** Per-attempt request deadline; the body must arrive inside it. */
export const HISTORY_REQUEST_TIMEOUT_MS = 8_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: HISTORY_STALE_TIME_MS,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // A request that may be transient gets two retries inside a 30s budget
        // (1s then 2s of backoff, each attempt bounded by the 8s deadline).
        // A 400/404 is an answer, not a blip: retrying it only delays the
        // honest state the reader needs.
        retry: (failureCount, error) => {
          const status = (error as { status?: unknown }).status;
          if (status === 400 || status === 404) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
      },
    },
  });
}

/** The one client the app mounts; tests construct their own. */
export const queryClient = createQueryClient();
