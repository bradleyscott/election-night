#!/usr/bin/env node
/**
 * Fetch official NZ electorate boundaries and write them as the slim GeoJSON
 * the dashboard map consumes.
 *
 * Why this exists
 * ---------------
 * Electorate boundaries are redrawn each cycle by the Representation
 * Commission. The 2026 general election (7 November 2026) uses the boundaries
 * gazetted on 8 August 2025: 64 general electorates (down from 65 in 2023)
 * and 7 Māori electorates, with 10 general electorates renamed or replaced.
 * A map built for 2023 therefore cannot be reused as-is.
 *
 * Source of truth
 * ---------------
 * Stats NZ publishes the final boundaries on the Stats NZ / ArcGIS Online
 * Map Hub, which is publicly queryable without an API key:
 *
 *   General Electorates 2025  64 features
 *   Māori Electorates 2025     7 features
 *
 * (Same data as the Datafinder layers 122741 / 122742, but Datafinder's export
 * and WFS endpoints require a free API key whereas the ArcGIS feature service
 * does not.) Licensed CC BY 4.0 — Stats NZ.
 *
 * Output shape
 * ------------
 * The map only needs a name and a numeric id, so we drop every other field and
 * write the app's minimal shape:
 *
 *   { type: 'FeatureCollection',
 *     features: [{ type: 'Feature', id: 12, geometry, properties: { name } }] }
 *
 * Names keep their macrons (`Ōtāhuhu`, `Māngere`, `Kaikōura`) because that is
 * how the Electoral Commission's XML feed spells them. The map also matches on
 * a diacritic-stripped form, so an ASCII-only feed would still line up.
 *
 * Usage
 * -----
 *   node scripts/fetch-electorate-boundaries.mjs                 # 2026, ~55 m
 *   node scripts/fetch-electorate-boundaries.mjs --year 2026
 *   node scripts/fetch-electorate-boundaries.mjs --tolerance 0.001   # ~110 m
 *   node scripts/fetch-electorate-boundaries.mjs --check          # no writes
 *
 * `--tolerance` is the ArcGIS `maxAllowableOffset` in degrees (WGS84), so
 * 0.0005 ≈ 55 m. Lower is more detailed and a bigger download. After writing,
 * `public/boundaries/index.json` is rebuilt from every year directory so the
 * client can pick the set whose electorate names match the live results.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BOUNDARIES_DIR = join(REPO_ROOT, 'packages/dashboard/public/boundaries');

/** Degrees of longitude/latitude used to round coordinates on output. */
const COORD_DECIMALS = 5;

const ARCGIS_ORG =
  'https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services';

/**
 * Boundary datasets per election year. `service` is the Stats NZ layer name,
 * `codeField`/`nameField` are its attribute columns, and `output` is the file
 * written into `public/boundaries/<year>/`.
 */
const DATASETS = {
  2026: {
    general: {
      service: 'General_Electorates_2025',
      label: 'General Electorates 2025',
      codeField: 'GED2025_V1_00',
      nameField: 'GED2025_V1_00_NAME',
      output: 'general-electorates.geojson',
    },
    maori: {
      service: 'M%C4%81ori_Electorates_2025',
      label: 'Māori Electorates 2025',
      codeField: 'MED2025_V1_00',
      nameField: 'MED2025_V1_00_NAME',
      output: 'maori-electorates.geojson',
    },
  },
};

function parseArgs(argv) {
  const options = {
    year: '2026',
    tolerance: '0.0005',
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--year') options.year = argv[++i];
    else if (arg === '--tolerance') options.tolerance = argv[++i];
    else if (arg === '--check') options.check = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!Object.hasOwn(DATASETS, options.year)) {
    const known = Object.keys(DATASETS).join(', ');
    console.error(
      `No boundary dataset configured for ${options.year}. Known years: ${known}.\n` +
        'Add an entry to DATASETS in this script (Stats NZ layer + field names).'
    );
    process.exit(1);
  }
  if (!Number.isFinite(Number(options.tolerance))) {
    console.error(`--tolerance must be a number, got "${options.tolerance}"`);
    process.exit(1);
  }
  return options;
}

function round(value) {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Round the positions of a linear ring and drop consecutive duplicates.
 * `maxAllowableOffset` already thins the vertices server-side; this only
 * trims the byte count.
 */
function compactRing(ring) {
  const out = [];
  let previous = null;
  for (const position of ring) {
    const point = [round(position[0]), round(position[1])];
    if (previous && point[0] === previous[0] && point[1] === previous[1]) {
      continue;
    }
    out.push(point);
    previous = point;
  }
  return out;
}

/**
 * Round and trim a geometry's coordinates. The ArcGIS GeoJSON response uses
 * MultiPolygon for the general electorates and a mix of Polygon/MultiPolygon
 * for the Māori ones, so handle both.
 */
function compactCoordinates(geometry) {
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((polygon) => polygon.map(compactRing));
  }
  return geometry.coordinates.map(compactRing);
}

function countVertices(geometry) {
  let count = 0;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      count += 1;
      return;
    }
    for (const child of coords) walk(child);
  };
  walk(geometry.coordinates);
  return count;
}

async function queryLayer(dataset, tolerance) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: `${dataset.codeField},${dataset.nameField}`,
    outSR: '4326',
    returnGeometry: 'true',
    f: 'geojson',
    maxAllowableOffset: tolerance,
    geometryPrecision: String(COORD_DECIMALS),
  });
  const url = `${ARCGIS_ORG}/${dataset.service}/FeatureServer/0/query?${params}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${dataset.label} (${url})`);
  }

  const body = await res.json();
  if (body.error) {
    throw new Error(
      `ArcGIS error for ${dataset.label}: ${JSON.stringify(body.error)}`
    );
  }
  if (!Array.isArray(body.features) || body.features.length === 0) {
    throw new Error(`No features returned for ${dataset.label}`);
  }
  return body;
}

/** Convert an ArcGIS GeoJSON response into the app's minimal feature shape. */
function toAppGeoJson(raw, dataset) {
  const features = raw.features
    .map((feature) => {
      const name = feature.properties?.[dataset.nameField];
      const code = Number(feature.properties?.[dataset.codeField]);
      if (!name || !feature.geometry) return null;
      return {
        type: 'Feature',
        id: Number.isFinite(code) ? code : undefined,
        geometry: {
          type: feature.geometry.type,
          coordinates: compactCoordinates(feature.geometry),
        },
        properties: { name: String(name) },
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const expected = raw.features.length;
  if (features.length !== expected) {
    throw new Error(
      `Dropped ${expected - features.length} of ${expected} ${dataset.label} features (missing name or geometry)`
    );
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Rebuild `public/boundaries/index.json` from every year directory on disk.
 *
 * The client uses this to pick the boundary set matching the live results:
 * running against 2023 data must not render 2026 polygons. Only names are
 * stored, so the manifest stays a couple of kilobytes.
 */
function writeManifest() {
  const years = readdirSync(BOUNDARIES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const manifest = {
    _comment:
      'Generated by scripts/fetch-electorate-boundaries.mjs — do not edit by hand. Boundary data: Stats NZ (CC BY 4.0).',
    years: {},
  };

  for (const year of years) {
    const yearDir = join(BOUNDARIES_DIR, year);
    const entry = {};
    for (const kind of ['general', 'maori']) {
      const file = join(yearDir, `${kind}-electorates.geojson`);
      let names;
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        names = parsed.features.map((f) => f.properties.name);
      } catch {
        continue; // Year directory without this kind of boundary.
      }
      entry[kind] = names;
    }
    manifest.years[year] = entry;
  }

  const manifestPath = join(BOUNDARIES_DIR, 'index.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, years: manifest.years };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const datasets = DATASETS[options.year];

  console.log(
    `Fetching ${options.year} electorate boundaries (maxAllowableOffset=${options.tolerance}° ≈ ${Math.round(Number(options.tolerance) * 111_000)} m)`
  );

  const results = {};
  for (const [kind, dataset] of Object.entries(datasets)) {
    const raw = await queryLayer(dataset, options.tolerance);
    const geoJson = toAppGeoJson(raw, dataset);
    const vertices = geoJson.features.reduce(
      (sum, f) => sum + countVertices(f.geometry),
      0
    );
    const serialized = `${JSON.stringify(geoJson)}\n`;
    results[kind] = {
      dataset,
      featureCount: geoJson.features.length,
      vertices,
      bytes: Buffer.byteLength(serialized),
      serialized,
    };
    console.log(
      `  ${dataset.label.padEnd(26)} ${String(geoJson.features.length).padStart(3)} features  ` +
        `${String(vertices).padStart(7)} vertices  ${(Buffer.byteLength(serialized) / 1024).toFixed(0)} KB`
    );
  }

  if (options.check) {
    console.log('--check: no files written');
    return;
  }

  const yearDir = join(BOUNDARIES_DIR, options.year);
  mkdirSync(yearDir, { recursive: true });
  for (const [kind, result] of Object.entries(results)) {
    const file = join(yearDir, result.dataset.output);
    writeFileSync(file, result.serialized);
    console.log(`Wrote ${file.replace(`${REPO_ROOT}/`, '')}`);
  }

  const { manifestPath, years } = writeManifest();
  console.log(
    `Wrote ${manifestPath.replace(`${REPO_ROOT}/`, '')} (years: ${Object.keys(years).join(', ')})`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
