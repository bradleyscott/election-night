import { useMemo } from 'react';
import type { SeatChance } from '@election-night/core/seat-probability';
import {
  nationalSwingOf,
  seatChanceFor,
} from '@election-night/core/notional-baseline';
import { normalizeElectorateName } from '../lib/electorates.js';
import { baselineFor } from '../lib/seat-chance.js';
import { useRuntimeConfig } from './useRuntimeConfig.js';
import type { ElectorateResult } from '@election-night/core/types';

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
  const config = useRuntimeConfig();
  const electionYear = config?.electionYear ?? null;
  const baseline = useMemo(() => baselineFor(electionYear), [electionYear]);

  const nationalSwing = useMemo(
    () => nationalSwingOf(baseline, electorates),
    [baseline, electorates]
  );

  const chances = useMemo(() => {
    const byName = new Map<string, SeatChance>();
    for (const electorate of electorates) {
      byName.set(
        normalizeElectorateName(electorate.electorateName),
        seatChanceFor(electorate, baseline, nationalSwing, electionYear)
      );
    }
    return byName;
  }, [baseline, electorates, electionYear, nationalSwing]);

  return { electionYear, chances };
}
