import { useApi } from './useApi.js';
import { useSocket } from '../context/SocketProvider.js';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  PriorWinnersResponse,
} from '../lib/history-types.js';

const API_BASE = '/api/history';

/**
 * History is served by the collector, not by the socket payload, so it does
 * not move when a results update arrives. Key the request to
 * `resultsUpdatedAt` so an open chart catches up with the count instead of
 * freezing on the snapshot it happened to load (the Mt Roskill chart showed
 * Wood ahead while the table beside it had Cheung ahead).
 */
function useResultsRefreshKey(): number | null {
  return useSocket().resultsUpdatedAt?.getTime() ?? null;
}

export function useElectorateHistory(electorateName: string | null) {
  const refreshKey = useResultsRefreshKey();
  const { data, loading, error, refetch } = useApi<ElectorateHistoryPoint[]>(
    electorateName
      ? `${API_BASE}/electorate/${encodeURIComponent(electorateName)}`
      : null,
    refreshKey
  );
  return { data, loading, error, refetch };
}

export function usePartyVoteHistory() {
  const refreshKey = useResultsRefreshKey();
  const { data, loading, error, refetch } = useApi<PartyVoteHistoryPoint[]>(
    `${API_BASE}/party-votes`,
    refreshKey
  );
  return { data, loading, error, refetch };
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
