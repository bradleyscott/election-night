import { useEffect, useState } from 'react';
import type { RuntimeConfig } from '@election-night/core/polls-close';

/**
 * `GET /api/config` — the cycle being served and when its polls close.
 *
 * Two hooks need it (`usePollsClose` for the masthead, `useSeatChances` for the
 * baseline), and `Layout` mounts one of them on every page, so the Electorates
 * page used to issue three identical requests in the same tick. They now share
 * one in-flight promise: the config is static for a deployment — only
 * `serverTime` moves, and nothing reads it — but it is *not* cached past the
 * request, so a test that restubs `fetch` and a visitor who reloads both see a
 * fresh answer.
 *
 * A failure is silent, as it was with `useApi` here: the dateline falls back to
 * the plain clock and the seat model reports no baseline, which is what the
 * dashboard shows before the first scrape anyway.
 */
let inflight: Promise<RuntimeConfig> | null = null;

function loadConfig(): Promise<RuntimeConfig> {
  if (!inflight) {
    inflight = fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RuntimeConfig>;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** The runtime config, or null until it has loaded. */
export function useRuntimeConfig(): RuntimeConfig | null {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);

  useEffect(() => {
    let live = true;
    loadConfig()
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return config;
}
