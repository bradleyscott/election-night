import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { partyColors } from '../lib/constants.js';
import { dashboardClientConfig } from '../config.js';
import {
  BOUNDARY_MANIFEST_PATH,
  boundaryGeoJsonPath,
  compareBoundaryNames,
  focusBounds,
  isMaoriElectorate,
  normalizeElectorateName,
  selectBoundaryYear,
  type BoundaryKind,
  type BoundaryManifest,
} from '../lib/electorates.js';
import 'leaflet/dist/leaflet.css';

const defaultIconPrototype = L.Icon.Default.prototype as unknown as Record<
  string,
  unknown
>;
delete defaultIconPrototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  VotingResults,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

interface ElectorateMapProps {
  electorates: ElectorateResult[];
  selectedName?: string;
  showMaori: boolean;
  showPartyVote?: boolean;
}

const GEO_KINDS: Record<'general' | 'maori', BoundaryKind> = {
  general: 'general',
  maori: 'maori',
};

/** Whole-country view, used when nothing is selected or nothing can be fitted. */
const DEFAULT_CENTER: L.LatLngTuple = [-41.5, 173.5];
const DEFAULT_ZOOM = 5.5;

type GeoFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  { name: string }
>;

function isGeoFeatureCollection(data: unknown): data is GeoFeatureCollection {
  return (
    typeof data === 'object' &&
    data !== null &&
    'features' in data &&
    Array.isArray((data as GeoFeatureCollection).features)
  );
}

function isBoundaryManifest(data: unknown): data is BoundaryManifest {
  return (
    typeof data === 'object' &&
    data !== null &&
    'years' in data &&
    typeof (data as BoundaryManifest).years === 'object'
  );
}

/**
 * The manifest is small and immutable for the life of the page, so fetch it
 * once per session rather than per map mount (the general/Māori toggle
 * remounts the map).
 */
let manifestPromise: Promise<BoundaryManifest> | null = null;

function loadBoundaryManifest(): Promise<BoundaryManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(BOUNDARY_MANIFEST_PATH)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as unknown;
        if (!isBoundaryManifest(data)) {
          throw new Error('Invalid boundary manifest');
        }
        return data;
      })
      .catch((err) => {
        // Allow a later mount to retry rather than caching the failure.
        manifestPromise = null;
        throw err;
      });
  }
  return manifestPromise;
}

function leadingPartyVote(
  partyVotes: VotingResults[]
): VotingResults | undefined {
  if (partyVotes.length === 0) return undefined;
  let top = partyVotes[0];
  for (let i = 1; i < partyVotes.length; i++) {
    if (partyVotes[i].votes > top.votes) top = partyVotes[i];
  }
  return top;
}

function getCandidateOpacity(result: ElectorateResult): number {
  const moe = result.marginOfError;
  const marginPercent = result.leaders.marginPercent;
  if (!Number.isFinite(moe) || moe <= 0) return 0.2;
  const ratio = marginPercent / moe;
  if (ratio >= 2) return 0.8;
  if (ratio <= 1) return 0.2;
  return 0.2 + (ratio - 1) * 0.6;
}

function getPartyOpacity(
  leading: VotingResults | undefined,
  votesCounted: number
): number {
  if (!leading || votesCounted <= 0) return 0.15;
  const share = leading.votes / votesCounted;
  if (!Number.isFinite(share)) return 0.15;
  if (share >= 0.5) return 0.8;
  if (share <= 0.2) return 0.2;
  return 0.2 + ((share - 0.2) / 0.3) * 0.6;
}

function MapUpdater({
  selectedName,
  geoData,
}: {
  selectedName?: string;
  geoData: GeoFeatureCollection | null;
}) {
  const map = useMap();
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedName && geoData) {
      const wanted = normalizeElectorateName(selectedName);
      const feature = geoData.features.find(
        (f) =>
          typeof f.properties?.name === 'string' &&
          normalizeElectorateName(f.properties.name) === wanted
      );
      if (feature) {
        // Not `layer.getBounds()`: electorates that include an island group
        // across the antimeridian (Te Tai Tonga and Wellington Bays both take
        // in the Chathams) would span ~352° of longitude and fit the Pacific.
        const bounds = focusBounds(feature.geometry);
        rafRef.current = requestAnimationFrame(() => {
          map.invalidateSize();
          if (bounds) {
            map.fitBounds(
              L.latLngBounds(
                [bounds.minLat, bounds.minLon],
                [bounds.maxLat, bounds.maxLon]
              ),
              { padding: [30, 30] }
            );
          } else {
            map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
          }
        });
      }
    } else if (geoData) {
      rafRef.current = requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      });
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [selectedName, geoData, map]);

  return null;
}

type LoadedBoundary = {
  geoData: GeoFeatureCollection;
  year: string;
  unmatchedLive: string[];
  orphanPolygons: string[];
};

/**
 * Counts of electorates and boundaries that do not line up with each other,
 * summarised for a one-line warning.
 */
function describeMismatch(boundary: LoadedBoundary): string | null {
  const { unmatchedLive, orphanPolygons, year } = boundary;
  if (unmatchedLive.length === 0 && orphanPolygons.length === 0) return null;

  const list = (names: string[]) => {
    const shown = names.slice(0, 4).join(', ');
    return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
  };

  const parts: string[] = [];
  if (unmatchedLive.length > 0) {
    parts.push(
      `${unmatchedLive.length} electorates in the results have no ${year} boundary (${list(unmatchedLive)})`
    );
  }
  if (orphanPolygons.length > 0) {
    parts.push(
      `${orphanPolygons.length} drawn boundaries have no results (${list(orphanPolygons)})`
    );
  }
  return `${parts.join('; ')}.`;
}

export default function ElectorateMap({
  electorates,
  selectedName,
  showMaori,
  showPartyVote,
}: ElectorateMapProps) {
  const [boundary, setBoundary] = useState<LoadedBoundary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const geoKey = showMaori ? 'maori' : 'general';

  // Electorate names are stable during a count but the results array is not,
  // so key the boundary fetch on the names alone — otherwise every socket
  // update would re-download the GeoJSON.
  const liveNamesKey = useMemo(
    () =>
      electorates
        .map((e) => e.electorateName)
        .sort()
        .join('|'),
    [electorates]
  );

  const lookup = useMemo(() => {
    const map = new Map<
      string,
      {
        color: string;
        opacity: number;
      }
    >();
    for (const e of electorates) {
      const key = normalizeElectorateName(e.electorateName);
      if (showPartyVote) {
        const leading = leadingPartyVote(e.partyVotes);
        map.set(key, {
          color: partyColors[leading?.candidate ?? ''] || '#9ca3af',
          opacity: getPartyOpacity(leading, e.votesCounted),
        });
      } else {
        map.set(key, {
          color:
            partyColors[e.leaders.leadingCandidateParty ?? ''] || '#9ca3af',
          opacity: getCandidateOpacity(e),
        });
      }
    }
    return map;
  }, [electorates, showPartyVote]);

  useEffect(() => {
    setBoundary(null);
    setError(null);
    const controller = new AbortController();
    const kind = GEO_KINDS[geoKey];
    const liveNames = liveNamesKey ? liveNamesKey.split('|') : [];

    (async () => {
      const manifest = await loadBoundaryManifest();
      const choice = selectBoundaryYear(
        manifest,
        liveNames,
        dashboardClientConfig.boundaryYear
      );
      if (!choice.year) {
        throw new Error('no boundary datasets available');
      }

      const res = await fetch(boundaryGeoJsonPath(choice.year, kind), {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as unknown;
      if (!isGeoFeatureCollection(data)) {
        throw new Error('Invalid GeoJSON payload');
      }

      const polygonNames = data.features
        .map((f) => f.properties?.name)
        .filter((name): name is string => typeof name === 'string');

      // Compare against only the electorates this file is supposed to cover:
      // the other kind legitimately has no polygons here.
      const displayedLive = liveNames.filter(
        (name) => isMaoriElectorate(name) === showMaori
      );

      setBoundary({
        geoData: data,
        year: choice.year,
        ...compareBoundaryNames(displayedLive, polygonNames),
      });
    })().catch((err) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load map');
    });

    return () => controller.abort();
  }, [geoKey, liveNamesKey, showMaori]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:h-[600px] border bg-muted/20">
        <p className="text-muted-foreground text-sm">Map error: {error}</p>
      </div>
    );
  }

  if (!boundary) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:h-[600px] border bg-muted/20">
        <p className="text-muted-foreground animate-pulse-soft">Loading map…</p>
      </div>
    );
  }

  const mismatch = describeMismatch(boundary);
  const geoData = boundary.geoData;

  return (
    <div>
      {mismatch && (
        <div className="border-b bg-muted/30 px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
          <span className="chip-print chip-print--red self-start">
            Boundary mismatch
          </span>
          <p className="text-xs text-muted-foreground leading-snug">
            {mismatch} The map may be showing the wrong electoral cycle.
          </p>
        </div>
      )}
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomSnap={0.5}
        className="h-[300px] sm:h-[600px] w-full"
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <GeoJSON
          key={`${geoKey}-${showPartyVote ? 'party' : 'candidate'}`}
          data={geoData}
          style={(feature) => {
            const name = feature?.properties?.name;
            const key = name ? normalizeElectorateName(name) : null;
            const isSelected =
              key !== null &&
              selectedName !== undefined &&
              normalizeElectorateName(selectedName) === key;
            const style = key ? lookup.get(key) : undefined;
            return {
              fillColor: style?.color ?? '#e5e7eb',
              weight: isSelected ? 3 : 1,
              opacity: 1,
              color: isSelected ? '#000' : '#fff',
              fillOpacity: style?.opacity ?? 0.15,
            };
          }}
          onEachFeature={(feature, layer) => {
            const name = feature.properties.name;

            layer.bindTooltip(name, {
              permanent: true,
              direction: 'center',
              className: 'electorate-label',
            });

            layer.on({
              click: () => {
                navigate(`/electorates/${encodeURIComponent(name)}`);
              },
            });
          }}
        />
        <MapUpdater selectedName={selectedName} geoData={geoData} />
      </MapContainer>
      <div className="border-t px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="chip-print">{boundary.year} electorates</span>
        <span className="text-[0.625rem] text-muted-foreground">
          Boundaries: Stats NZ (CC BY 4.0)
        </span>
      </div>
    </div>
  );
}
