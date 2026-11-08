import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { VotingPlacesResponse } from '@election-night/core/voting-places';
import { fetchJsonWithMeta } from '../lib/history-api.js';
import { HISTORY_STALE_TIME_MS } from '../lib/query-client.js';
import { useRuntimeConfig } from './useRuntimeConfig.js';

/** What the map and the card need: the places standing in the electorate. */
export type VotingPlaceSummary = {
  /** Places inside the electorate whose count has landed. */
  counted: number;
  /** Places inside the electorate due to report; always `places.length`. */
  total: number;
  /** Newest receipt time across those places, or null before any land. */
  latestAt: string | null;
  places: VotingPlacesResponse['places'];
};

/** How often a seat that is still counting refreshes its places. */
const REFRESH_MS = 60_000;
/** After every place has reported, corrections still arrive; keep asking. */
const COMPLETE_REFRESH_MS = 5 * 60_000;

/**
 * The polling policy, exposed so it can be tested without waiting a minute.
 *
 * A missing or failed answer still polls: an initial outage must not freeze
 * the layer. A completed seat slows down but does not stop, because
 * corrections and specials can land after the night's first count.
 */
export function votingPlacesRefetchMs(
  data: VotingPlacesResponse | undefined
): number | false {
  if (data && !data.available) return false;
  const summary = data ? summarizePlaces(data) : null;
  if (summary && summary.counted >= summary.total) return COMPLETE_REFRESH_MS;
  return REFRESH_MS;
}

/**
 * Reduce a seat's place answer to the places standing inside it.
 *
 * Only those are drawn and counted. A place filed under this seat from another
 * electorate — an advance voting hub for a general seat, and every place for a
 * Māori seat, because `vp_e_no` never carries a Māori electorate number — is
 * not a booth in this electorate, so adding it to a card labelled "voting
 * places" would put two different things behind one number. A seat with no
 * in-seat place (all seven Māori seats) has nothing to draw or count, and
 * returns null rather than 0 / 0.
 */
export function summarizePlaces(
  data: VotingPlacesResponse
): VotingPlaceSummary | null {
  if (!data.available) return null;
  const places = data.places.filter((place) => place.group === 'seat');
  if (places.length === 0) return null;

  let counted = 0;
  let latestAt: string | null = null;
  for (const place of places) {
    if (place.countedAt === null) continue;
    counted += 1;
    if (latestAt === null || place.countedAt > latestAt) {
      latestAt = place.countedAt;
    }
  }

  return { counted, total: places.length, latestAt, places };
}

/**
 * Which places inside a seat have reported.
 *
 * The collector answers this on demand, so this is a query, not socket state.
 * A failed first request leaves the query active: React Query's retry policy
 * and the interval both keep trying, so an initial outage cannot freeze the
 * layer. A seat whose places have all reported slows to five minutes rather
 * than stopping, because corrections and specials still land after the night.
 */
export function useVotingPlaces(electorateName: string | null): {
  summary: VotingPlaceSummary | null;
  /** The contributing set: places whose results count here, including elsewhere. */
  contributing: { counted: number; total: number } | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const config = useRuntimeConfig();
  const cycle = config?.electionYear ?? null;
  const url = electorateName
    ? `/api/history/voting-places/${encodeURIComponent(electorateName)}`
    : null;

  const query = useQuery({
    queryKey: ['voting-places', cycle, electorateName],
    queryFn: ({ signal }) =>
      fetchJsonWithMeta<VotingPlacesResponse>(url!, signal).then(
        (result) => result.data
      ),
    enabled: !!url && !!cycle,
    staleTime: HISTORY_STALE_TIME_MS,
    refetchInterval: (query) => votingPlacesRefetchMs(query.state.data),
  });

  const summary = useMemo(
    () => (query.data ? summarizePlaces(query.data) : null),
    [query.data]
  );

  return {
    summary,
    // The contributing set is the feed's own count, including places filed
    // under this seat from elsewhere. The in-seat booths above are what the map
    // draws; the two are deliberately not the same number.
    contributing: query.data?.available
      ? { counted: query.data.counted, total: query.data.total }
      : null,
    loading: query.isPending && summary === null,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Format a place receipt time as it is printed in the feed, without a timezone
 * conversion: the feed writes New Zealand wall-clock time and the reader wants
 * the time the count landed on election night, not that instant on their own
 * device's clock.
 */
export function formatReceiptTime(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const hour = Number(match[1]);
  const minute = match[2]!;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute}${suffix}`;
}
