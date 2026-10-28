import { useEffect, useMemo, useState } from 'react';
import type { VotingPlacesResponse } from '@election-night/core/voting-places';
import { useApi } from './useApi.js';

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
 * The collector answers this on demand (the feed publishes no per-place data
 * for an archived cycle, and the register is too large to poll), so this is a
 * plain request rather than something the results socket pushes. While a seat
 * is still counting it re-reads once a minute; a seat whose places have all
 * reported stops asking, which is most seats by mid-evening.
 */
export function useVotingPlaces(electorateName: string | null): {
  summary: VotingPlaceSummary | null;
  loading: boolean;
} {
  const url = useMemo(
    () =>
      electorateName
        ? `/api/history/voting-places/${encodeURIComponent(electorateName)}`
        : null,
    [electorateName]
  );

  const { data, loading, refetch } = useApi<VotingPlacesResponse>(url);
  const [complete, setComplete] = useState(false);

  // Reset the "finished" latch when the visitor picks another seat.
  useEffect(() => {
    setComplete(false);
  }, [url]);

  const summary = useMemo<VotingPlaceSummary | null>(
    () => (data ? summarizePlaces(data) : null),
    [data]
  );

  useEffect(() => {
    if (!summary) return;
    if (summary.counted >= summary.total) {
      setComplete(true);
      return;
    }
    if (complete) return;
    const timer = setInterval(refetch, REFRESH_MS);
    return () => clearInterval(timer);
  }, [summary, complete, refetch]);

  return { summary, loading: loading && summary === null };
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
