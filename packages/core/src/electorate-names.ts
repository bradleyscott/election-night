/**
 * Electorate name handling.
 *
 * Names come from two independent publishers — the Electoral Commission's XML
 * feed (live and archived cycles) and Stats NZ's boundary geometry — and both
 * mix macronised and ASCII spellings (`Ōtāhuhu` / `Otahuhu`, `Māngere` /
 * `Mangere`). Anything that compares a name from one source against a name
 * from another must compare them the way a reader would: ignoring macrons,
 * case and punctuation. Two copies of that rule would eventually disagree and
 * the failure mode is silent (an electorate quietly stops matching), so it
 * lives here and is re-exported by the dashboard's `lib/electorates.ts`.
 */

/**
 * Compare electorate names the way a reader would: ignore macrons and case,
 * and treat hyphens/punctuation as spaces.
 */
export function normalizeElectorateName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
