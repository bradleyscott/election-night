import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { partyColors } from '../lib/constants.js';
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

const GEO_FILES = {
  general: '/general-electorates.geojson',
  maori: '/maori-electorates.geojson',
};

const MAORI_ELECTORATES = new Set([
  'Hauraki-Waikato',
  'Ikaroa-Rāwhiti',
  'Tāmaki Makaurau',
  'Te Tai Hauāuru',
  'Te Tai Tokerau',
  'Te Tai Tonga',
  'Waiariki',
]);

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
      const feature = geoData.features.find(
        (f) => f.properties?.name === selectedName
      );
      if (feature) {
        const layer = L.geoJSON(feature);
        rafRef.current = requestAnimationFrame(() => {
          map.invalidateSize();
          map.fitBounds(layer.getBounds(), { padding: [30, 30] });
        });
      }
    } else if (geoData) {
      rafRef.current = requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView([-41.5, 173.5], 5.5);
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

export default function ElectorateMap({
  electorates,
  selectedName,
  showMaori,
  showPartyVote,
}: ElectorateMapProps) {
  const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const geoKey = showMaori ? 'maori' : 'general';

  const lookup = useMemo(() => {
    const map = new Map<
      string,
      {
        color: string;
        opacity: number;
      }
    >();
    for (const e of electorates) {
      if (showPartyVote) {
        const leading = leadingPartyVote(e.partyVotes);
        map.set(e.electorateName, {
          color: partyColors[leading?.candidate ?? ''] || '#9ca3af',
          opacity: getPartyOpacity(leading, e.votesCounted),
        });
      } else {
        map.set(e.electorateName, {
          color:
            partyColors[e.leaders.leadingCandidateParty ?? ''] || '#9ca3af',
          opacity: getCandidateOpacity(e),
        });
      }
    }
    return map;
  }, [electorates, showPartyVote]);

  useEffect(() => {
    setGeoData(null);
    setError(null);
    const controller = new AbortController();

    fetch(GEO_FILES[geoKey], { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as unknown;
        if (!isGeoFeatureCollection(data)) {
          throw new Error('Invalid GeoJSON payload');
        }
        setGeoData(data);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load map');
      });

    return () => controller.abort();
  }, [geoKey]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:h-[600px] border bg-muted/20">
        <p className="text-muted-foreground text-sm">Map error: {error}</p>
      </div>
    );
  }

  if (!geoData) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:h-[600px] border bg-muted/20">
        <p className="text-muted-foreground animate-pulse-soft">Loading map…</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={[-41.5, 173.5]}
      zoom={5.5}
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
          const isSelected = name === selectedName;
          const style = name ? lookup.get(name) : undefined;
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
  );
}

export { MAORI_ELECTORATES };
