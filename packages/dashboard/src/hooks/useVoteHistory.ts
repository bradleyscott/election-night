import { useHistoryCollection, useHistoryObject } from '../lib/history-api.js';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  PriorWinnersResponse,
} from '../lib/history-types.js';

const API_BASE = '/api/history';

/**
 * History is served by the collector, not by the socket payload, so it does
 * not move when a results update arrives. `useHistorySocketSync` invalidates
 * these queries on every update, and the 30s poll is the backstop when a
 * notification lands inside the proxy's 10s cache window.
 */
export function useElectorateHistory(electorateName: string | null) {
  return useHistoryCollection<ElectorateHistoryPoint>(
    ['history', 'electorate', electorateName ?? ''],
    electorateName
      ? `${API_BASE}/electorate/${encodeURIComponent(electorateName)}`
      : null,
    !!electorateName
  );
}

export function usePartyVoteHistory() {
  return useHistoryCollection<PartyVoteHistoryPoint>(
    ['history', 'party-votes'],
    `${API_BASE}/party-votes`
  );
}

/**
 * Prior-cycle winners, matched to the current cycle's electorates.
 *
 * The collector fetches archived cycles lazily and caches them, so the first
 * caller may wait a couple of seconds; `enabled` keeps pages that only need it
 * once an electorate is selected from paying that cost on load.
 */
export function usePriorWinners(enabled = true) {
  const result = useHistoryObject<PriorWinnersResponse>(
    ['history', 'prior-winners'],
    enabled ? `${API_BASE}/prior-winners` : null,
    enabled
  );
  return {
    ...result,
    // No usable prior cycle: the collector could not reach an archive, or this
    // deployment's connector only serves the live cycle.
    unavailable:
      result.state === 'unavailable' ||
      (!result.loading &&
        !result.error &&
        !!result.data &&
        result.data.primaryYear === null),
  };
}
