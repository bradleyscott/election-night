import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { VotingPlaceStatus } from '@election-night/core/voting-places';
import type { VotingPlaceSummary } from '../hooks/useVotingPlaces.js';
import { formatReceiptTime } from '../hooks/useVotingPlaces.js';
import { cn } from '../lib/utils.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tooltipHtml(place: VotingPlaceStatus): string {
  const status =
    place.countedAt === null
      ? 'Not yet counted'
      : `Reported at ${formatReceiptTime(place.countedAt)}`;
  const scope =
    place.group === 'advance'
      ? `<span class="voting-place-tip__scope">Advance voting place</span>`
      : '';
  return `<div class="voting-place-tip">
    <b>${escapeHtml(place.name)}</b>
    ${place.address ? `<span>${escapeHtml(place.address)}</span>` : ''}
    ${scope}
    <em>${status}</em>
  </div>`;
}

/**
 * One mark per voting place that counts towards the selected electorate.
 *
 * Shape carries where the place stands — a square is a booth in the
 * electorate, a circle is an advance voting place elsewhere — and fill carries
 * its count: solid once the count has been received, outlined while it is
 * outstanding. The four combinations are what the legend under the map names.
 *
 * Places with no coordinates (mobile teams, care-home visits) are left to the
 * ledger: they are counted but were never anywhere to draw.
 */
export function VotingPlacesLayer({ places }: { places: VotingPlaceStatus[] }) {
  const map = useMap();

  useEffect(() => {
    const group = L.layerGroup();
    for (const place of places) {
      if (place.lat === null || place.lon === null) continue;
      const counted = place.countedAt !== null;
      const shape = place.group === 'advance' ? 'circle' : 'square';
      const icon = L.divIcon({
        className: 'voting-place-pip-anchor',
        html: `<span class="voting-place-pip voting-place-pip--${shape}${
          counted ? '' : ' voting-place-pip--open'
        }"></span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const marker = L.marker([place.lat, place.lon], {
        icon,
        riseOnHover: true,
        alt: place.name,
        title: place.name,
      });
      marker.bindTooltip(tooltipHtml(place), {
        className: 'voting-place-tip-anchor',
        direction: 'top',
        offset: [0, -8],
        opacity: 1,
      });
      group.addLayer(marker);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, places]);

  return null;
}

const GROUP_LABELS: Record<string, string> = {
  seat: 'In this electorate',
  advance: 'Advance voting places',
  mobile: 'Mobile voting teams',
};

/** The 2×2 key for the marks, one row per state. */
export function VotingPlaceLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 font-label text-[0.625rem] text-muted-foreground',
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="voting-place-pip voting-place-pip--square" />
        Counted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="voting-place-pip voting-place-pip--square voting-place-pip--open" />
        Not yet counted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="voting-place-pip voting-place-pip--circle" />
        Advance, counted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="voting-place-pip voting-place-pip--circle voting-place-pip--open" />
        Advance, not yet
      </span>
    </div>
  );
}

function latestLabel(latestAt: string | null): string | null {
  return latestAt ? formatReceiptTime(latestAt) : null;
}

/**
 * How much of the selected seat's count has landed, by place.
 *
 * On a desktop map this is a card in the corner of the map, over the water
 * where nothing is drawn. It is not drawn on a phone at all: the map is only
 * 300px tall there, a card would cover half of it, and the seat panel below
 * already states the count.
 */
export function VotingPlaceLedger({
  summary,
  loading,
  className,
}: {
  summary: VotingPlaceSummary;
  loading?: boolean;
  className?: string;
}) {
  const time = latestLabel(summary.latestAt);
  return (
    <div
      className={cn('panel-print px-3 py-2.5', className)}
      aria-label={`${summary.counted} of ${summary.total} voting places counted`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="kicker">Voting places</div>
        {time && (
          <span className="font-label text-[0.625rem] tabular-nums text-muted-foreground">
            {time}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold leading-none tabular-nums">
          {summary.counted}
        </span>
        <span className="font-display text-lg leading-none tabular-nums text-muted-foreground">
          / {summary.total}
        </span>
        <span className="font-label text-[0.6875rem] leading-tight text-muted-foreground">
          {loading ? 'reading places…' : 'counted'}
        </span>
      </div>
      <div className="mt-2 border-t pt-1.5 space-y-0.5">
        {summary.groups.map((group) => (
          <div
            key={group.key}
            className={cn(
              'flex items-baseline justify-between gap-3 font-label text-[0.6875rem] tabular-nums',
              group.key === 'mobile' && 'pl-3 text-muted-foreground'
            )}
          >
            <span>{GROUP_LABELS[group.key]}</span>
            <span>
              {group.counted} / {group.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
