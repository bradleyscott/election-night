import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { partyColors } from '../lib/constants.js';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
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

function MapUpdater({
  selectedName,
  geoData,
}: {
  selectedName?: string;
  geoData: any;
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedName && geoData) {
      const feature = geoData.features.find(
        (f: any) => f.properties.name === selectedName
      );
      if (feature) {
        const layer = L.geoJSON(feature);
        requestAnimationFrame(() => {
          map.invalidateSize();
          map.fitBounds(layer.getBounds(), { padding: [30, 30] });
        });
      }
    } else if (geoData) {
      requestAnimationFrame(() => {
        map.invalidateSize();
        map.setView([-41.5, 173.5], 5.5);
      });
    }
  }, [selectedName, geoData, map]);

  return null;
}

export default function ElectorateMap({
  electorates,
  selectedName,
  showMaori,
  showPartyVote,
}: ElectorateMapProps) {
  const [geoData, setGeoData] = useState<any>(null);
  const navigate = useNavigate();

  const geoKey = showMaori ? 'maori' : 'general';

  const getLeadingParty = (result: ElectorateResult) =>
    [...result.partyVotes].sort((a, b) => b.votes - a.votes)[0];

  useEffect(() => {
    setGeoData(null);
    fetch(GEO_FILES[geoKey])
      .then((res) => res.json())
      .then(setGeoData);
  }, [geoKey]);

  const resultMap = new Map(electorates.map((e) => [e.electorateName, e]));

  const getColor = (name: string) => {
    const result = resultMap.get(name);
    if (!result) return '#e5e7eb';
    if (showPartyVote) {
      const leading = getLeadingParty(result);
      return partyColors[leading?.candidate ?? ''] || '#9ca3af';
    }
    return partyColors[result.leaders.leadingCandidateParty ?? ''] || '#9ca3af';
  };

  const getOpacity = (name: string) => {
    const result = resultMap.get(name);
    if (!result) return 0.15;
    if (showPartyVote) {
      const leading = getLeadingParty(result);
      if (!leading) return 0.15;
      const share = leading.votes / result.votesCounted;
      if (share >= 0.5) return 0.8;
      if (share <= 0.2) return 0.2;
      return 0.2 + ((share - 0.2) / 0.3) * 0.6;
    }
    const ratio = result.leaders.marginPercent / result.marginOfError;
    if (ratio >= 2) return 0.8;
    if (ratio <= 1) return 0.2;
    return 0.2 + (ratio - 1) * 0.6;
  };

  if (!geoData) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:h-[600px] border rounded-lg bg-muted/20">
        <p className="text-muted-foreground animate-pulse-soft">Loading map…</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={[-41.5, 173.5]}
      zoom={5.5}
      zoomSnap={0.5}
      className="h-[300px] sm:h-[600px] w-full rounded-lg"
      scrollWheelZoom={true}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <GeoJSON
        key={`${geoKey}-${showPartyVote ? 'party' : 'candidate'}-${electorates.map((e) => showPartyVote ? (getLeadingParty(e)?.candidate ?? '') : (e.leaders.leadingCandidateParty ?? '')).join(',')}`}
        data={geoData}
        style={(feature) => {
          const name = feature?.properties?.name;
          const isSelected = name === selectedName;
          return {
            fillColor: getColor(name),
            weight: isSelected ? 3 : 1,
            opacity: 1,
            color: isSelected ? '#000' : '#fff',
            fillOpacity: getOpacity(name),
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
