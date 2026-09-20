import { describe, expect, test } from 'vitest';
import boundaryManifest from '../../public/boundaries/index.json';
import { ELECTORATE_RENAMES } from '@election-night/core/electorate-successions';
import {
  BOUNDARY_MANIFEST_PATH,
  MAORI_ELECTORATES,
  boundaryGeoJsonPath,
  compareBoundaryNames,
  focusBounds,
  isMaoriElectorate,
  normalizeElectorateName,
  selectBoundaryYear,
  type BoundaryManifest,
} from './electorates.js';

/**
 * The real manifest shipped to the client. Reading it (rather than only
 * asserting against fixtures above) is what catches "the new boundaries were
 * never checked in" and "the manifest still lists the 2023 electorates".
 */
const shipped = boundaryManifest as BoundaryManifest;
const shippedYears = Object.keys(shipped.years);

describe('normalizeElectorateName', () => {
  test('ignores macrons and case', () => {
    expect(normalizeElectorateName('Ōtāhuhu')).toBe('otahuhu');
    expect(normalizeElectorateName('Otahuhu')).toBe('otahuhu');
    expect(normalizeElectorateName('Māngere')).toBe(
      normalizeElectorateName('Mangere')
    );
    expect(normalizeElectorateName('Kaikōura')).toBe('kaikoura');
    expect(normalizeElectorateName('Te Atatū')).toBe('te atatu');
  });

  test('treats punctuation and whitespace as separators', () => {
    expect(normalizeElectorateName('Panmure-Ōtāhuhu')).toBe('panmure otahuhu');
    expect(normalizeElectorateName('  Mt   Albert ')).toBe('mt albert');
    expect(normalizeElectorateName('West Coast-Tasman')).toBe(
      'west coast tasman'
    );
  });
});

describe('isMaoriElectorate', () => {
  test('recognises the seven Māori electorates', () => {
    for (const name of MAORI_ELECTORATES) {
      expect(isMaoriElectorate(name), name).toBe(true);
    }
  });

  test('recognises ASCII spellings of the same names', () => {
    // A feed serving macron-stripped names must not file Māori seats as general.
    expect(isMaoriElectorate('Ikaroa-Rawhiti')).toBe(true);
    expect(isMaoriElectorate('Tamaki Makaurau')).toBe(true);
    expect(isMaoriElectorate('Te Tai Hauauru')).toBe(true);
  });

  test('does not claim general electorates', () => {
    for (const name of [
      'Kapiti',
      'Kenepuru',
      'Wellington Bays',
      'Otahuhu',
      'Mt Maunganui',
    ]) {
      expect(isMaoriElectorate(name), name).toBe(false);
    }
  });
});

describe('selectBoundaryYear', () => {
  const manifest: BoundaryManifest = {
    years: {
      '2023': {
        general: ['Bay of Plenty', 'Kelston', 'Mana'],
        maori: ['Waiariki'],
      },
      '2026': {
        general: ['Mt Maunganui', 'Glendene', 'Kenepuru'],
        maori: ['Waiariki'],
      },
    },
  };

  test('picks the year whose names cover the live results', () => {
    const choice = selectBoundaryYear(manifest, [
      'Mt Maunganui',
      'Glendene',
      'Kenepuru',
      'Waiariki',
    ]);
    expect(choice.year).toBe('2026');
    expect(choice.coverage).toBe(1);
    expect(choice.unmatched).toEqual([]);
  });

  test('falls back to 2023 for 2023-shaped results', () => {
    const choice = selectBoundaryYear(manifest, ['Bay of Plenty', 'Kelston']);
    expect(choice.year).toBe('2023');
    expect(choice.coverage).toBe(1);
  });

  test('honours an explicit preferred year over the best match', () => {
    const choice = selectBoundaryYear(
      manifest,
      ['Mt Maunganui', 'Glendene'],
      '2023'
    );
    expect(choice.year).toBe('2023');
    expect(choice.unmatched).toEqual(['Mt Maunganui', 'Glendene']);
  });

  test('matches the preferred year using normalised names', () => {
    const choice = selectBoundaryYear(manifest, ['Mt Maunganui']);
    expect(normalizeElectorateName('Mt Maunganui')).toBe('mt maunganui');
    expect(choice.year).toBe('2026');
  });

  test('uses the newest dataset before any results arrive', () => {
    expect(selectBoundaryYear(manifest, []).year).toBe('2026');
  });

  test('returns no year when there are no datasets', () => {
    const choice = selectBoundaryYear({ years: {} }, ['Epsom']);
    expect(choice.year).toBeNull();
    expect(choice.unmatched).toEqual(['Epsom']);
  });
});

describe('compareBoundaryNames', () => {
  test('reports both directions of a cycle mismatch', () => {
    const report = compareBoundaryNames(
      ['Ōtaki', 'Mana', 'Ōhāriu', 'Mt Maunganui'],
      ['Kapiti', 'Kenepuru', 'Mt Maunganui']
    );
    expect(report.unmatchedLive).toEqual(['Ōtaki', 'Mana', 'Ōhāriu']);
    expect(report.orphanPolygons).toEqual(['Kapiti', 'Kenepuru']);
  });

  test('is clean when names agree apart from macrons', () => {
    const report = compareBoundaryNames(
      ['Otahuhu', 'Mangere', 'Waitakere'],
      ['Ōtāhuhu', 'Māngere', 'Waitākere']
    );
    expect(report).toEqual({ unmatchedLive: [], orphanPolygons: [] });
  });
});

describe('electorate name split', () => {
  test('MAORI_ELECTORATES matches the boundaries on disk for every year', () => {
    expect(shippedYears.length).toBeGreaterThan(0);
    for (const year of shippedYears) {
      const maori = shipped.years[year]?.maori ?? [];
      expect(maori.length, `${year} maori electorates`).toBe(7);
      expect(new Set(maori), `${year} maori electorates`).toEqual(
        MAORI_ELECTORATES
      );
    }
  });
});

describe('boundary datasets on disk', () => {
  test('2026 has 64 general and 7 Māori electorates', () => {
    expect(shipped.years['2026']?.general).toHaveLength(64);
    expect(shipped.years['2026']?.maori).toHaveLength(7);
  });

  test('2026 includes the new and renamed electorates, and not the abolished ones', () => {
    const general = new Set(shipped.years['2026']?.general ?? []);
    // Created or renamed by the 2025 Representation Commission.
    for (const name of [
      'Kapiti',
      'Kenepuru',
      'Glendene',
      'Henderson',
      'Waitākere',
      'Ōtāhuhu',
      'Mt Maunganui',
      'East Cape',
      'Wellington North',
      'Wellington Bays',
    ]) {
      expect(general, `${name} should exist in 2026`).toContain(name);
    }
    // Abolished or replaced for 2026.
    for (const name of [
      'Ōtaki',
      'Mana',
      'Ōhāriu',
      'Kelston',
      'New Lynn',
      'Te Atatū',
      'Panmure-Ōtāhuhu',
      'Rongotai',
      'Wellington Central',
      'East Coast',
      'Bay of Plenty',
    ]) {
      expect(general, `${name} should be gone in 2026`).not.toContain(name);
    }
  });

  test('2023 and 2026 share no general electorate set, so the year matters', () => {
    const a = new Set(shipped.years['2023']?.general ?? []);
    const b = new Set(shipped.years['2026']?.general ?? []);
    const removed = [...a].filter((n) => !b.has(n));
    const added = [...b].filter((n) => !a.has(n));
    // 2023: 65 general electorates, 2026: 64 — one fewer, 10 renamed/replaced.
    expect(a.size).toBe(65);
    expect(b.size).toBe(64);
    expect(removed).toHaveLength(11);
    expect(added).toHaveLength(10);
  });

  test('the year-selector resolves the shipped manifest to a real dataset', () => {
    const choice = selectBoundaryYear(shipped, [], undefined);
    expect(choice.year).toBe('2026');
    expect(BOUNDARY_MANIFEST_PATH).toBe('/boundaries/index.json');
    expect(boundaryGeoJsonPath(choice.year!, 'general')).toBe(
      '/boundaries/2026/general-electorates.geojson'
    );
  });
});

/**
 * The rename table drives prior-winner matching (`electorate-successions.ts`),
 * so a name that does not exist in the cycle it claims to belong to would
 * silently drop or mis-attribute a seat. Check every entry against the
 * boundary manifests actually shipped. The 2020 boundaries applied to both the
 * 2020 and 2023 elections, so 2020's names are the 2023 manifest's names.
 */
describe('electorate rename table matches the boundaries on disk', () => {
  // The 2020 boundaries applied to both the 2020 and 2023 elections, so the
  // 2023 manifest is the 2020 cycle's name list. 2017 names are not shipped,
  // so for the 2017→2020 step only the destination and the disappearance of
  // the old name are checkable.
  const namesFor = (year: string) =>
    new Set(
      year === '2026'
        ? (shipped.years['2026']?.general ?? [])
        : (shipped.years['2023']?.general ?? [])
    );

  test('every rename lands on a name that exists in its cycle', () => {
    for (const [year, renames] of Object.entries(ELECTORATE_RENAMES)) {
      const target = namesFor(year);
      for (const { from, to } of renames) {
        expect(target.has(to), `${year}: ${to} (from ${from})`).toBe(true);
      }
    }
  });

  test('the old name is gone from the cycle the rename lands in', () => {
    for (const [year, renames] of Object.entries(ELECTORATE_RENAMES)) {
      const target = namesFor(year);
      for (const { from } of renames) {
        expect(target.has(from), `${year}: ${from} should be gone`).toBe(false);
      }
    }
  });

  test('renames that land in 2026 come from names 2023 actually had', () => {
    const general2023 = namesFor('2023');
    for (const { from } of ELECTORATE_RENAMES['2026'] ?? []) {
      expect(general2023.has(from), `2026 rename source ${from}`).toBe(true);
    }
  });
});

describe('focusBounds', () => {
  /** A rectangle, as a Polygon with one ring. */
  const rect = (
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number
  ): [number, number][] => [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];

  // Real extents from public/boundaries/2026/maori-electorates.geojson.
  const CHATHAM_ISLANDS = rect(-177.358, -44.608, -175.5, -43.347);
  const TE_TAI_TONGA_MAINLAND = rect(166.139, -47.724, 174.868, -40.298);
  // Real extents from public/boundaries/2026/general-electorates.geojson.
  const WELLINGTON = rect(174.429, -41.558, 174.853, -41.272);
  const AUCKLAND_ISTHMUS = rect(174.709, -36.868, 174.796, -36.832);
  const HAURAKI_GULF = rect(174.819, -36.936, 175.903, -35.74);

  test('fits a single-polygon electorate', () => {
    expect(focusBounds({ type: 'Polygon', coordinates: [WELLINGTON] })).toEqual(
      {
        minLat: -41.558,
        maxLat: -41.272,
        minLon: 174.429,
        maxLon: 174.853,
      }
    );
  });

  test('ignores an island group across the antimeridian', () => {
    // Regression: Te Tai Tonga's Chatham Islands polygon made the union span
    // 352 degrees of longitude, so clicking it zoomed out to the whole Pacific.
    const bounds = focusBounds({
      type: 'MultiPolygon',
      coordinates: [[CHATHAM_ISLANDS], [TE_TAI_TONGA_MAINLAND]],
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.minLon).toBeCloseTo(166.139, 3);
    expect(bounds!.maxLon).toBeCloseTo(174.868, 3);
    expect(bounds!.minLat).toBeCloseTo(-47.724, 3);
    expect(bounds!.maxLat).toBeCloseTo(-40.298, 3);
    expect(bounds!.maxLon - bounds!.minLon).toBeLessThan(30);
  });

  test('fits the mainland for an electorate whose outlying group is larger', () => {
    // Wellington Bays: the Chathams polygon has more vertices and a bigger
    // bounding box than the Wellington one, so picking the largest part would
    // zoom to the Chatham Islands instead of Wellington.
    const bounds = focusBounds({
      type: 'MultiPolygon',
      coordinates: [[CHATHAM_ISLANDS], [WELLINGTON]],
    });
    expect(bounds!.minLat).toBeCloseTo(-41.558, 3);
    expect(bounds!.minLon).toBeCloseTo(174.429, 3);
  });

  test('keeps near-shore islands with the mainland', () => {
    // Auckland Central takes in Great Barrier and Waiheke, which are part of
    // the electorate and must not be treated as outliers.
    const bounds = focusBounds({
      type: 'MultiPolygon',
      coordinates: [[AUCKLAND_ISTHMUS], [HAURAKI_GULF]],
    });
    expect(bounds!.minLon).toBeCloseTo(174.709, 3);
    expect(bounds!.maxLon).toBeCloseTo(175.903, 3);
    expect(bounds!.maxLat).toBeCloseTo(-35.74, 3);
  });

  test('fits an electorate that is entirely outside the main-island band', () => {
    // No such electorate exists today, but if one did (say the Chathams ever
    // became a seat of their own) it should be zoomed to, not dropped.
    expect(
      focusBounds({ type: 'MultiPolygon', coordinates: [[CHATHAM_ISLANDS]] })
    ).toEqual({
      minLat: -44.608,
      maxLat: -43.347,
      minLon: -177.358,
      maxLon: -175.5,
    });
  });

  test('keeps the country view rather than a whole-turn box', () => {
    // Defensive: any geometry whose parts still span an implausible width gets
    // no viewport at all, so a future data surprise cannot zoom out to the
    // globe the way the Chathams polygon did.
    const farAway = rect(-120, -20, -119, -19);
    expect(
      focusBounds({
        type: 'MultiPolygon',
        coordinates: [[CHATHAM_ISLANDS], [farAway]],
      })
    ).toBeNull();
  });

  test('returns null for empty or unusable geometry', () => {
    expect(focusBounds({ type: 'Polygon', coordinates: [] })).toBeNull();
    expect(focusBounds({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
    expect(
      focusBounds({ type: 'Point', coordinates: [174.7, -41.2] })
    ).toBeNull();
    expect(
      focusBounds({ type: 'Polygon', coordinates: 'nonsense' })
    ).toBeNull();
  });
});
