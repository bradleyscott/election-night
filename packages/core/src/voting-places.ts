/**
 * Voting places: where the count comes from, and how much of it has landed.
 *
 * The Commission publishes three things per cycle that are not part of the
 * results feed's main files:
 *
 *  - `votingplaces.xml`, the register: every place's `vp_id`, the electorate
 *    it stands in, its address and its coordinates (empty for the mobile
 *    teams and care-home visits, which have no fixed location).
 *  - `e{NN}/votingplaces/`, a directory listing of one result file per place
 *    that counts towards electorate `NN`, named `{NN}-{vp_e_no}{vp_no}.xml`.
 *  - those result files, each carrying its `vp_id`, `vp_no` and
 *    `time_received` — empty until the place's count is published.
 *
 * The directory listing is the only record of *which* places will report for
 * a seat: a place file exists, zeroed, from the day the feed is published, so
 * "the file exists" says nothing about whether it has counted. `time_received`
 * does, which is why the status of a place is read from the file body rather
 * than inferred from the listing.
 *
 * Place results also break the assumption that a place counts for the
 * electorate it stands in: in 2023, out-of-seat places carried 2,313 of Te
 * Tai Tonga's 4,383 votes (its voters are everywhere), and a single place
 * (the Overseas vote) counted for all 72.
 *
 * Two different things produce such a result, and the classification below has
 * to serve both without claiming more than the feed states:
 *
 *  - For a **general seat**, an out-of-seat place is in practice an advance
 *    voting place. A vote cast on election day at a place outside the voter's
 *    electorate is a special vote, counted in the electorate it was cast for
 *    rather than at the booth, so a booth in another general electorate cannot
 *    report for this seat on the night. The live 2026 register has 2,686
 *    places, of which 785 stand outside at least one other general electorate
 *    they count for — against the 829 advance voting places and 2,334
 *    election-day places the Commission reported for 2023.
 *  - For a **Māori seat**, an out-of-seat place is usually an ordinary
 *    election-day booth. `vp_e_no` never holds a Māori electorate number (all
 *    2,686 2026 entries carry 1–64), so no place can be recorded as standing
 *    in a Māori electorate and every place counting for one is formally
 *    out-of-seat — 2,685 of the 2,686 places appear in some Māori seat's
 *    listing. Those votes are ordinary ones: every voting place holds rolls for
 *    both its general and its Māori electorate, so a voter on the Māori roll is
 *    marked off the printed roll at their local booth.
 *
 * The group therefore names where the place stands, which is what the feed
 * says, and never when the vote was cast — the register carries no advance flag
 * and one place holds both.
 *
 * Parsing only — fetching belongs to the collector, which owns rate limiting
 * and caching for the feed.
 */

import { toArray, xmlParser } from './xml.js';

/** One entry of `votingplaces.xml`. */
export type VotingPlace = {
  /** `vp_id` — the key the per-place result files carry. */
  id: number;
  /** `vp_e_no` — the electorate the place stands in, when known. */
  electorateNo: number | null;
  /** The venue: the address up to its first comma. */
  name: string;
  /** Everything after the venue's name, or empty when there is nothing more. */
  address: string;
  lat: number | null;
  lon: number | null;
};

/** One file in `e{NN}/votingplaces/`, i.e. one place that counts for a seat. */
export type VotingPlaceListingEntry = {
  /** Electorate the place stands in (`vp_e_no`), from the file name. */
  electorateNo: number;
  /** Place number within that electorate (`vp_no`). */
  placeNo: number;
  /** File name as listed, e.g. `01-01001.xml`. */
  file: string;
};

/** What a place's result file says about its count. */
export type VotingPlaceCount = {
  id: number;
  electorateNo: number;
  placeNo: number;
  /** When the count was received, ISO 8601; null while the place is outstanding. */
  countedAt: string | null;
  /** Ballot papers issued at the place, party and candidate votes combined. */
  issued: number;
};

/**
 * Where the seat's places stand, and why it matters:
 *
 *  - `seat` — a booth standing in the electorate, drawn on the map.
 *  - `elsewhere` — a place outside the electorate that still counts towards it,
 *    drawn wherever it actually is. For a general seat that is in practice an
 *    advance voting place (Te Tai Tonga takes advance votes from booths in
 *    Auckland); for a Māori seat it is almost every place, because `vp_e_no`
 *    can never name a Māori electorate.
 *  - `mobile` — a mobile team or a care-home visit, recorded against the
 *    electorate with no fixed location, so it can be counted but not drawn.
 *
 * The name states a position, not a time: the register carries no advance
 * flag, so an `elsewhere` place may have counted advance or election-day votes.
 */
export type VotingPlaceGroup = 'seat' | 'elsewhere' | 'mobile';

/** A place as the dashboard draws it: register entry plus its count state. */
export type VotingPlaceStatus = {
  /** `vp_id` when the register matched; null for a listing entry it did not. */
  id: number | null;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  /** Electorate the place itself stands in, resolved to a name when possible. */
  electorateName: string | null;
  group: VotingPlaceGroup;
  countedAt: string | null;
};

/**
 * `/history/voting-places/:electorate` response. `available` is false when the
 * source cannot answer for the cycle at all — the archives publish place
 * results but forbid directory listing, so an archived cycle has no way to
 * learn which places were due.
 */
export type VotingPlacesResponse = {
  electorateName: string;
  year: string;
  available: boolean;
  /** Why the places could not be listed, when `available` is false. */
  reason: 'not-live' | 'unreachable' | null;
  /** Places whose count has landed. */
  counted: number;
  /** Places due to report for this electorate; always `places.length`. */
  total: number;
  places: VotingPlaceStatus[];
};

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function asNumber(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Split a register address into the venue and the rest.
 *
 * The register has no separate name element: the address is one string and the
 * venue is its first line, delimited by the first comma —
 * `"Auckland University, Student Engagement Kate Edgar, Room B315, ..."`. A
 * few entries are a label rather than an address (`"Mobile Team, Team 1,
 * Taken in Ōtāhuhu Electorate"`), where the first line is still the only part
 * worth putting on a marker's first line.
 */
export function splitVotingPlaceAddress(raw: string): {
  name: string;
  address: string;
} {
  const text = raw.trim();
  const comma = text.indexOf(',');
  if (comma === -1) return { name: text, address: '' };
  return {
    name: text.slice(0, comma).trim(),
    address: text.slice(comma + 1).trim(),
  };
}

/** Parse `votingplaces.xml` into register entries, in file order. */
export function parseVotingPlaceRegistry(xml: string): VotingPlace[] {
  if (!xml.trim()) return [];
  const doc = xmlParser.parse(xml) as {
    votingplaces?: { votingplace?: unknown };
  };
  const entries = toArray<Record<string, unknown>>(
    doc.votingplaces?.votingplace
  );

  const places: VotingPlace[] = [];
  for (const entry of entries) {
    const id = asNumber(entry.vp_id);
    if (id === null) continue;
    const { name, address } = splitVotingPlaceAddress(asText(entry.vp_address));
    places.push({
      id,
      electorateNo: asNumber(entry.vp_e_no),
      name,
      address,
      lat: asNumber(entry.vp_lat),
      lon: asNumber(entry.vp_lon),
    });
  }
  return places;
}

/**
 * Parse the index of `e{NN}/votingplaces/` for the place result files it
 * lists. The page is an Apache autoindex; only the link names matter, and
 * matching on the file-name shape rather than the table markup keeps this
 * working whichever date/size columns the server emits.
 */
export function parseVotingPlaceListing(
  html: string
): VotingPlaceListingEntry[] {
  const seen = new Set<string>();
  const entries: VotingPlaceListingEntry[] = [];
  for (const match of html.matchAll(/(\d{2,3})-(\d{2})(\d{3})\.xml/g)) {
    const file = match[0];
    if (seen.has(file)) continue;
    seen.add(file);
    const electorateNo = Number(match[2]);
    const placeNo = Number(match[3]);
    if (!Number.isFinite(electorateNo) || !Number.isFinite(placeNo)) continue;
    entries.push({ electorateNo, placeNo, file });
  }
  return entries;
}

/**
 * Parse one place's result file. Returns null when the body is not a place
 * result at all (an HTML error page, an empty response).
 */
export function parseVotingPlaceResult(xml: string): VotingPlaceCount | null {
  if (!xml.trim()) return null;
  let doc: { votingplace?: Record<string, unknown> };
  try {
    doc = xmlParser.parse(xml) as { votingplace?: Record<string, unknown> };
  } catch {
    return null;
  }
  const place = doc.votingplace;
  if (!place) return null;

  const id = asNumber(place.vp_id);
  if (id === null) return null;

  const statistics = (place.statistics ?? {}) as Record<string, unknown>;
  const countedAt = asText(place.time_received);

  return {
    id,
    electorateNo: asNumber(place.vp_e_no) ?? 0,
    placeNo: asNumber(place.vp_no) ?? 0,
    countedAt: countedAt || null,
    issued: asNumber(statistics.total_issued_ballot_papers) ?? 0,
  };
}

/**
 * A place has counted when the Commission has published a receipt time for it.
 *
 * The files are published zeroed before election night, and a mobile team or
 * care-home visit legitimately issues no ballots at all, so a vote count is
 * not a substitute for the receipt time: `time_received` is the only thing
 * that distinguishes "counted, and emitted nothing" from "not yet counted".
 */
export function hasCounted(
  count: Pick<VotingPlaceCount, 'countedAt'>
): boolean {
  return count.countedAt !== null;
}
