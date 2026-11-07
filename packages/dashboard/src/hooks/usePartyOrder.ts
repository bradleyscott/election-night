import { useState, useEffect, useMemo, useCallback } from 'react';
import { defaultOrder } from '../lib/parliament.js';
import type { PartyVoteResult } from '@election-night/core/types';

// v2: the default order changed from seat-count order to the conventional
// left-to-right chamber order. This hook writes its order to storage on mount,
// so every returning visitor has the old default saved; without a new key the
// new default would never reach them.
const STORAGE_KEY = 'parliament-party-order:v2';

export function usePartyOrder(partyVote: PartyVoteResult[]) {
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    const active = partyVote.filter((p) => p.seats > 0).map((p) => p.candidate);

    let base: string[] | null = null;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed.filter((p) => active.includes(p));
        if (valid.length === active.length) {
          base = valid;
        }
      } catch {
        /* ignore */
      }
    }

    setOrder(base ?? defaultOrder(partyVote));
  }, [partyVote]);

  useEffect(() => {
    if (order.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
      } catch {
        /* storage unavailable — order stays in memory for this visit */
      }
    }
  }, [order]);

  const resetOrder = useCallback(() => {
    setOrder(defaultOrder(partyVote));
  }, [partyVote]);

  // Nothing to reset while the chamber already reads in its default order. An
  // empty order is the first paint, before the effect has seated the parties,
  // and must not flash the control either.
  const isDefault = useMemo(() => {
    const defaults = defaultOrder(partyVote);
    return (
      order.length === 0 ||
      (order.length === defaults.length &&
        order.every((party, i) => party === defaults[i]))
    );
  }, [order, partyVote]);

  return { order, setOrder, resetOrder, isDefault };
}
