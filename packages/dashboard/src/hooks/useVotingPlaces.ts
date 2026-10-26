import { useEffect, useMemo, useState } from 'react';
import type {
  VotingPlaceGroup,
  VotingPlacesResponse,
} from '@election-night/core/voting-places';
import { useApi } from './useApi.js';

/** What the map needs: the counts, and the places that have a location. */
export type VotingPlaceSummary = {
  counted: number;
  total: number;
  /** Newest receipt time across the counted places, or null before any land. */
  latestAt: string | null;
  groups: { key: VotingPlaceGroup; counted: number; total: number }[];
  places: VotingPlacesResponse['places'];
};

/** How often a seat that is still counting refreshes its places. */
const REFRESH_MS = 60_000;

/**
 * Which places count towards a seat and which have reported.
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

  const summary = useMemo<VotingPlaceSummary | null>(() => {
    if (!data || !data.available) return null;
    if (data.places.length === 0) return null;

    let latestAt: string | null = null;
    const groups: VotingPlaceSummary['groups'] = [
      { key: 'seat', counted: 0, total: 0 },
      { key: 'advance', counted: 0, total: 0 },
      { key: 'mobile', counted: 0, total: 0 },
    ];
    for (const place of data.places) {
      const group = groups.find((g) => g.key === place.group);
      if (group) {
        group.total += 1;
        if (place.countedAt !== null) group.counted += 1;
      }
      if (place.countedAt !== null) {
        if (latestAt === null || place.countedAt > latestAt) {
          latestAt = place.countedAt;
        }
      }
    }

    return {
      counted: data.counted,
      total: data.total,
      latestAt,
      groups: groups.filter((g) => g.total > 0),
      places: data.places,
    };
  }, [data]);

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
