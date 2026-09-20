/**
 * Which electorate in a later cycle is the *same seat* as one in an earlier
 * cycle.
 *
 * Electorate boundaries are redrawn each cycle and names change with them. A
 * historical comparison ("this seat was held by X in 2017") is only honest
 * where the electoral area continues: a seat that was *renamed*, or whose name
 * changed spelling, is comparable; a seat that only exists because two or more
 * former seats were merged, or one was split, is not, because there is no
 * single prior holder to name.
 *
 * The rule this data encodes:
 *
 *   Comparable  — the Representation Commission records a 1:1 name change for
 *                 a single continuing electorate (boundary adjustments are
 *                 normal and do not break continuity).
 *   Not comparable — new seats, and reorganisations where former electorates'
 *                 populations are redistributed to produce the new set.
 *
 * Seats that do not appear as a `from` entry are only comparable when the name
 * itself survives (including spelling-only differences, which
 * `normalizeElectorateName` already absorbs). Anything else resolves to no
 * prior holder and is left out of prior-winner comparisons rather than
 * guessed at.
 *
 * Sources: Representation Commission reports (2020, 2025) and
 * `docs/2026-election-boundaries.md`.
 */

import { normalizeElectorateName } from './electorate-names.js';

export type ElectorateRename = {
  /** Name in the earlier cycle. */
  from: string;
  /** Name in the cycle keyed by the containing map. */
  to: string;
  /** Where the equivalence is recorded. */
  source: string;
};

const RC_2020 =
  'Representation Commission 2020 (Boundary Review 2019/20), list of name changes';
const RC_2025 =
  'Representation Commission 2025 (see docs/2026-election-boundaries.md)';

/**
 * Renames keyed by the *later* cycle in the pair. The chain between any two
 * cycles is derived by walking these keys in year order, so a long-range
 * comparison (2017 → 2026) is composed from the pairwise steps instead of
 * being maintained as a second, drifting table.
 */
export const ELECTORATE_RENAMES: Record<string, ElectorateRename[]> = {
  // 2017 → 2020. Whangarei → Whangārei is a spelling-only change and needs no
  // entry: normalisation already treats the two as the same name.
  '2020': [
    { from: 'Clutha-Southland', to: 'Southland', source: RC_2020 },
    { from: 'Dunedin North', to: 'Dunedin', source: RC_2020 },
    { from: 'Dunedin South', to: 'Taieri', source: RC_2020 },
    { from: 'Helensville', to: 'Kaipara ki Mahurangi', source: RC_2020 },
    { from: 'Hunua', to: 'Port Waikato', source: RC_2020 },
    { from: 'Manukau East', to: 'Panmure-Ōtāhuhu', source: RC_2020 },
    { from: 'Port Hills', to: 'Banks Peninsula', source: RC_2020 },
    { from: 'Rimutaka', to: 'Remutaka', source: RC_2020 },
    { from: 'Rodney', to: 'Whangaparāoa', source: RC_2020 },
    // Takanini is the new South Auckland seat — no prior holder.
  ],
  // 2020 → 2023: the 2020 boundaries applied to both elections, so every name
  // carried over unchanged (verified against both XML feeds).
  '2023': [],
  // 2023 → 2026.
  '2026': [
    { from: 'Bay of Plenty', to: 'Mt Maunganui', source: RC_2025 },
    { from: 'East Coast', to: 'East Cape', source: RC_2025 },
    { from: 'Panmure-Ōtāhuhu', to: 'Ōtāhuhu', source: RC_2025 },
    { from: 'Rongotai', to: 'Wellington Bays', source: RC_2025 },
    { from: 'Wellington Central', to: 'Wellington North', source: RC_2025 },
    // Not comparable — merged to create new seats:
    //   Ōtaki + Mana + Ōhāriu     → Kapiti, Kenepuru
    //   Kelston + New Lynn + Te Atatū → Glendene, Henderson, Waitākere
  ],
};

const RENAME_YEARS = Object.keys(ELECTORATE_RENAMES)
  .map(Number)
  .filter((year) => Number.isFinite(year))
  .sort((a, b) => a - b);

/**
 * The seven Māori electorates carried their names unchanged from 2017 through
 * 2026 (three had boundaries adjusted, none were renamed), so they need no
 * entries here — normalisation alone matches them across cycles.
 */

/**
 * The cycles that have to be walked to get from `fromYear` to `toYear`, e.g.
 * `['2017', '2020', '2023']`. Empty when the range is empty or reversed.
 */
export function successionChain(fromYear: string, toYear: string): string[] {
  const from = Number(fromYear);
  const to = Number(toYear);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return [];
  return [from, ...RENAME_YEARS.filter((y) => y > from && y <= to)].map(String);
}

/**
 * Resolve an electorate name from an earlier cycle to the name the same seat
 * carries in a later cycle, applying each rename on the way through.
 *
 * Returns the name unchanged when no rename applies — the caller decides
 * whether that name still exists in the target cycle (`resolveBestEffortName`
 * never invents a seat, so a merged-away name simply fails that check and the
 * comparison is dropped).
 */
export function resolvePriorElectorateName(
  fromYear: string,
  toYear: string,
  name: string
): string {
  const chain = successionChain(fromYear, toYear);
  if (chain.length < 2) return name;

  let current = name;
  for (let i = 1; i < chain.length; i++) {
    const renames = ELECTORATE_RENAMES[chain[i]] ?? [];
    const key = normalizeElectorateName(current);
    const rename = renames.find((r) => normalizeElectorateName(r.from) === key);
    if (rename) current = rename.to;
  }
  return current;
}
