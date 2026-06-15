import { useState, useEffect, useCallback } from 'react';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  SnapshotMeta,
} from '../lib/history-types.js';

const API_BASE = '/api/history';

export function useElectorateHistory(electorateName: string | null) {
  const [data, setData] = useState<ElectorateHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!electorateName) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/electorate/${encodeURIComponent(electorateName)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ElectorateHistoryPoint[] = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [electorateName]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { data, loading, error, refetch: fetchHistory };
}

export function usePartyVoteHistory() {
  const [data, setData] = useState<PartyVoteHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/party-votes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PartyVoteHistoryPoint[] = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load party vote history');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { data, loading, error, refetch: fetchHistory };
}

export function useSnapshotMetas() {
  const [data, setData] = useState<SnapshotMeta[] | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/snapshots`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return data;
}
