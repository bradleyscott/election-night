import { useState, useEffect, useCallback } from 'react';
import { defaultOrder } from '../lib/parliament.js';
import type { PartyEntry } from '../lib/parliament.js';

const STORAGE_KEY = 'parliament-party-order';

export function usePartyOrder(partyVote: PartyEntry[]) {
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    const active = partyVote
      .filter((p) => p.seats > 0)
      .map((p) => p.candidate);

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

  return { order, setOrder, resetOrder };
}
