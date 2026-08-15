import { useApi } from './useApi.js';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  SnapshotMeta,
} from '../lib/history-types.js';

const API_BASE = '/api/history';

export function useElectorateHistory(electorateName: string | null) {
  const { data, loading, error, refetch } = useApi<ElectorateHistoryPoint[]>(
    electorateName
      ? `${API_BASE}/electorate/${encodeURIComponent(electorateName)}`
      : null
  );
  return { data, loading, error, refetch };
}

export function usePartyVoteHistory() {
  const { data, loading, error, refetch } = useApi<PartyVoteHistoryPoint[]>(
    `${API_BASE}/party-votes`
  );
  return { data, loading, error, refetch };
}

export function useSnapshotMetas() {
  return useApi<SnapshotMeta[]>(`${API_BASE}/snapshots`).data;
}
