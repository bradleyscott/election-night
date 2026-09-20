import { useApi } from './useApi.js';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  PriorWinnersResponse,
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

/**
 * Prior-cycle winners, matched to the current cycle's electorates.
 *
 * The collector fetches archived cycles lazily and caches them, so the first
 * caller may wait a couple of seconds; `enabled` keeps pages that only need it
 * once an electorate is selected from paying that cost on load.
 */
export function usePriorWinners(enabled = true) {
  const { data, loading, error } = useApi<PriorWinnersResponse>(
    enabled ? `${API_BASE}/prior-winners` : null
  );
  return {
    data,
    loading,
    error,
    // No usable prior cycle: the collector could not reach an archive, or this
    // deployment's connector only serves the live cycle.
    unavailable: !loading && !error && !!data && data.primaryYear === null,
  };
}
