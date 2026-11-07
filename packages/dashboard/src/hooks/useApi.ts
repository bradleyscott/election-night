import { useEffect, useState } from 'react';

/**
 * Generic JSON fetch hook with loading/error state.
 * Pass `null` as the url to skip fetching entirely.
 *
 * `refreshKey` lets a caller re-run a request that depends on live data the
 * URL cannot express (the socket's `resultsUpdatedAt`, for example). Passing a
 * different value fetches again; leaving it out keeps the old one-shot
 * behaviour.
 *
 * The request is aborted when the URL or refresh key changes, or the component
 * unmounts.
 */
export function useApi<T>(url: string | null, refreshKey?: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (url === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    setLoading(true);
    setError(null);

    fetch(url, { signal })
      .then((res) => {
        if (signal.aborted) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (signal.aborted) return;
        setData(json as T);
        setError(null);
      })
      .catch((err) => {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Request failed');
        setData(null);
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [url, tick, refreshKey]);

  const refetch = () => setTick((t) => t + 1);

  return { data, loading, error, refetch };
}
