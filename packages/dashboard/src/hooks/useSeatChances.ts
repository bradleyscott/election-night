import { useMemo } from 'react';
import type { RuntimeConfig } from '@election-night/core/polls-close';
import type { SeatChance } from '@election-night/core/seat-probability';
import { normalizeElectorateName } from '../lib/electorates.js';
import {
  nationalSwingOf,
  seatChanceFor,
  type ElectorateResult,
} from '../lib/seat-chance.js';
import { useApi } from './useApi.js';

/**
 * Every seat's chance of winning, keyed by normalised electorate name.
 *
 * Four pages ask the same question of the same payload — Seats, Electorates,
 * Close Calls and Flipped — and all four must quote the same number for a seat.
 * The swing is measured across every seat at once, so it is computed here once
 * per payload rather than per row: a per-row call would drift the moment one
 * page computed it from a filtered subset.
 *
 * The cycle comes from `GET /api/config` because the baseline, the enrolled
 * roll and the turnout constants are all per-cycle; the hook owns that request
 * so a caller cannot forget it.
 */
export function useSeatChances(electorates: ElectorateResult[]): {
  /** The cycle being served, or null when the server did not name one. */
  electionYear: string | null;
  /** Chance per seat, keyed by `normalizeElectorateName(electorateName)`. */
  chances: Map<string, SeatChance>;
} {
  const { data: config } = useApi<RuntimeConfig>('/api/config');
  const electionYear = config?.electionYear ?? null;

  const nationalSwing = useMemo(
    () => nationalSwingOf(electorates, electionYear),
    [electorates, electionYear]
  );

  const chances = useMemo(() => {
    const byName = new Map<string, SeatChance>();
    for (const electorate of electorates) {
      byName.set(
        normalizeElectorateName(electorate.electorateName),
        seatChanceFor(electorate, electionYear, nationalSwing)
      );
    }
    return byName;
  }, [electorates, electionYear, nationalSwing]);

  return { electionYear, chances };
}
