import { partyColor } from './constants.js';
import { normalizeElectorateName } from './electorates.js';
import { mapFillOpacity } from './seat-chance.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type {
  VotingResults,
  WithSeats,
  ElectorateResults,
  WithLeaders,
  PartyList,
  WithAdjustedRank,
} from '@election-night/core/types';

export type PartyEntry = VotingResults & WithSeats;
export type ElectorateEntry = ElectorateResults & WithLeaders;
export type PartyListEntry = PartyList & WithAdjustedRank;

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

export function defaultOrder(partyVote: PartyEntry[]): string[] {
  const sorted = [...partyVote]
    .filter((p) => p.seats > 0)
    .sort((a, b) => b.seats - a.seats);

  if (sorted.length <= 1) {
    return sorted.map((p) => p.candidate);
  }

  const biggest = sorted[0].candidate;
  const secondBiggest = sorted[1].candidate;
  const rest = sorted.slice(2).map((p) => p.candidate);
  return [biggest, ...rest, secondBiggest];
}

function getListOpacity(distanceFromCut: number): number {
  if (distanceFromCut >= 10) return 0.8;
  if (distanceFromCut <= 0) return 0.2;
  return 0.2 + (distanceFromCut / 10) * 0.6;
}

export function buildSeats(
  order: string[],
  partyVote: PartyEntry[],
  electorates: ElectorateEntry[],
  partyLists: PartyListEntry[],
  totalSeats: number,
  chances?: Map<string, SeatChance>
): SeatInfo[] {
  const out: SeatInfo[] = [];

  const partyElectorates = new Map<string, ElectorateEntry[]>();
  for (const e of electorates) {
    const p = e.leaders.leadingCandidateParty;
    if (!p) continue;
    const arr = partyElectorates.get(p) ?? [];
    arr.push(e);
    partyElectorates.set(p, arr);
  }

  const electorateWinner = new Map<string, string>();
  for (const e of electorates) {
    electorateWinner.set(e.leaders.leadingCandidate, e.electorateName);
  }

  const listCandidatesByParty = new Map<string, PartyListEntry[]>();
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
        candidate: e.leaders.leadingCandidate,
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
