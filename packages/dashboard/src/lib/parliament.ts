import {
  PARLIAMENT_PARTY_ORDER,
  canonicalPartyName,
  partyColor,
} from './constants.js';
import { normalizeElectorateName } from './electorates.js';
import { mapFillOpacity } from './seat-chance.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type {
  ElectorateResult,
  PartyListResult,
  PartyVoteResult,
} from '@election-night/core/types';

export const ROWS = 3;

export type SeatInfo = {
  party: string;
  color: string;
  opacity: number;
  type: 'electorate' | 'list';
  name: string;
  candidate?: string;
  margin?: number;
  marginPercent?: number;
  /**
   * The seat's chance of being won, when there is a prior and a live count.
   * A finished count carries a margin instead — the popover shows whatever
   * the count can actually support.
   */
  chance?: SeatChance;
  listRank?: number;
  adjustedRank?: number;
  distanceFromCut?: number;
};

/**
 * Where an otherwise unnamed party sits: between the left bloc and the right
 * bloc, just before New Zealand First. This is what puts Opportunity, and any
 * party registered after this was written, in the centre.
 */
const CENTRE_RANK =
  PARLIAMENT_PARTY_ORDER.indexOf('New Zealand First Party') - 0.5;

function parliamentRank(party: string): number {
  const index = PARLIAMENT_PARTY_ORDER.indexOf(canonicalPartyName(party));
  return index === -1 ? CENTRE_RANK : index;
}

/**
 * The chamber's default seating: the left bloc from the left edge, the centre
 * next, then the right bloc to the right edge. The chart and the table read in
 * this order.
 *
 * It is deliberately not ordered by seats. That put the largest party at the
 * far left and the second largest at the far right, which split each bloc
 * across the room and bore no relation to how the House is read. Ties between
 * centre parties fall to seats and then to name, so the seating does not
 * shuffle as the count moves; parties with no seats are left out entirely
 * (they appear behind "Show all parties" in the table instead).
 */
export function defaultOrder(partyVote: PartyVoteResult[]): string[] {
  return partyVote
    .filter((p) => p.seats > 0)
    .sort(
      (a, b) =>
        parliamentRank(a.candidate) - parliamentRank(b.candidate) ||
        b.seats - a.seats ||
        a.candidate.localeCompare(b.candidate)
    )
    .map((p) => p.candidate);
}

export type Coalition = {
  parties: PartyVoteResult[];
  cumulative: number;
};

/**
 * The most likely governing arrangement: the contiguous run of parties, in the
 * chamber's left-to-right order, that reaches the majority with the fewest
 * parties.
 *
 * Contiguity is the point. Choosing the fewest parties outright would pair
 * National with Labour in 2023, because those two alone clear the threshold,
 * and that is not a government anyone forms. Only neighbours in the chamber
 * are considered, so the answer is a bloc plus whatever it must reach across
 * for. Equal-sized runs are broken by the larger seat total, so the stronger
 * arrangement is the one shown.
 *
 * The members come back largest first: the footer reads as
 * "National + ACT + NZ First = 67 seats", whichever way round the chamber
 * happens to seat them.
 */
export function winningCoalition(
  order: string[],
  partyVote: PartyVoteResult[],
  majority: number
): Coalition {
  const active = order
    .map((name) => partyVote.find((p) => p.candidate === name))
    .filter((p): p is PartyVoteResult => p !== undefined && p.seats > 0);

  let best: Coalition | null = null;
  for (let start = 0; start < active.length; start++) {
    let cumulative = 0;
    for (let end = start; end < active.length; end++) {
      cumulative += active[end].seats;
      const parties = active.slice(start, end + 1);
      if (cumulative < majority) continue;
      if (
        best === null ||
        parties.length < best.parties.length ||
        (parties.length === best.parties.length && cumulative > best.cumulative)
      ) {
        best = { parties, cumulative };
      }
      // A longer run from this start only adds parties, so it cannot beat
      // this one on the count that matters.
      break;
    }
  }

  if (best !== null) {
    return {
      parties: [...best.parties].sort((a, b) => b.seats - a.seats),
      cumulative: best.cumulative,
    };
  }

  // Defensive: the whole chamber is always a winning coalition when the
  // majority is a majority of its own total, so this is only reachable if a
  // caller passes an impossible threshold.
  return {
    parties: [...active].sort((a, b) => b.seats - a.seats),
    cumulative: active.reduce((sum, p) => sum + p.seats, 0),
  };
}

function getListOpacity(distanceFromCut: number): number {
  if (distanceFromCut >= 10) return 0.8;
  if (distanceFromCut <= 0) return 0.2;
  return 0.2 + (distanceFromCut / 10) * 0.6;
}

export function buildSeats(
  order: string[],
  partyVote: PartyVoteResult[],
  electorates: ElectorateResult[],
  partyLists: PartyListResult[],
  totalSeats: number,
  chances?: Map<string, SeatChance>
): SeatInfo[] {
  const out: SeatInfo[] = [];

  const partyElectorates = new Map<string, ElectorateResult[]>();
  for (const e of electorates) {
    const p = e.leaders.leadingCandidateParty;
    if (!p) continue;
    const arr = partyElectorates.get(p) ?? [];
    arr.push(e);
    partyElectorates.set(p, arr);
  }

  const electorateWinner = new Map<string, string>();
  for (const e of electorates) {
    // Only a seat with a leader has an electorate winner. An uncounted seat
    // must not remove its alphabetical first candidate from the list pool.
    const candidate = e.leaders.leadingCandidate;
    if (!candidate) continue;
    electorateWinner.set(candidate, e.electorateName);
  }

  const listCandidatesByParty = new Map<string, PartyListResult[]>();
  for (const entry of partyLists) {
    const arr = listCandidatesByParty.get(entry.party) ?? [];
    arr.push(entry);
    listCandidatesByParty.set(entry.party, arr);
  }

  const midIndex = order.length / 2;

  for (let idx = 0; idx < order.length; idx++) {
    const name = order[idx];
    const p = partyVote.find((x) => x.candidate === name);
    if (!p || p.seats <= 0) continue;
    const color = partyColor(name);
    const elecSeats = p.electorateSeats;
    const listSeats = p.listSeats;

    const isRightSide = idx >= midIndex;

    const wins = (partyElectorates.get(name) ?? [])
      .slice()
      .sort((a, b) =>
        isRightSide
          ? a.leaders.marginPercent - b.leaders.marginPercent
          : b.leaders.marginPercent - a.leaders.marginPercent
      );

    const partySeats: SeatInfo[] = [];

    for (let i = 0; i < elecSeats && i < wins.length; i++) {
      const e = wins[i];
      partySeats.push({
        party: name,
        color,
        // The arc answers the same question as the map: how decided is this
        // seat. It runs on the chance of winning, so a 50/50 seat is pale
        // whichever party happens to be a hundred votes ahead.
        opacity: mapFillOpacity(
          chances?.get(normalizeElectorateName(e.electorateName))
        ),
        type: 'electorate',
        name: e.electorateName,
        candidate: e.leaders.leadingCandidate ?? undefined,
        margin: e.leaders.margin,
        marginPercent: e.leaders.marginPercent,
        chance: chances?.get(normalizeElectorateName(e.electorateName)),
      });
    }

    for (let i = wins.length; i < elecSeats; i++) {
      partySeats.push({
        party: name,
        color,
        opacity: 0.5,
        type: 'electorate',
        name: `Electorate ${i + 1}`,
      });
    }

    const partyListCandidates = (listCandidatesByParty.get(name) ?? [])
      .filter((c) => !electorateWinner.has(c.candidate))
      .sort((a, b) => a.adjustedRank - b.adjustedRank);

    for (let i = 0; i < listSeats; i++) {
      const c = partyListCandidates[i];
      partySeats.push({
        party: name,
        color,
        opacity:
          c?.distanceFromCut !== undefined
            ? getListOpacity(c.distanceFromCut)
            : 1,
        type: 'list',
        name: `List seat ${i + 1}`,
        candidate: c?.candidate,
        listRank: c?.listRank,
        adjustedRank: c?.adjustedRank,
        distanceFromCut: c?.distanceFromCut,
      });
    }

    if (isRightSide) {
      partySeats.sort((a, b) => a.opacity - b.opacity);
    } else {
      partySeats.sort((a, b) => b.opacity - a.opacity);
    }

    out.push(...partySeats);
  }

  while (out.length < totalSeats) {
    out.push({
      party: 'Vacant',
      color: '#444',
      opacity: 0.3,
      type: 'list',
      name: 'Vacant',
    });
  }

  return out;
}
