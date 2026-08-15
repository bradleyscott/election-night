import { useCallback, useEffect, useState } from 'react';

/**
 * Generic JSON fetch hook with loading/error state.
 * Pass `null` as the url to skip fetching entirely.
 */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (url === null) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as T);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
