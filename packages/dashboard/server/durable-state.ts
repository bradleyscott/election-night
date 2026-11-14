import type { LatestStateRow } from '@election-night/core/history';
import type { ResultsEnvelope } from '@election-night/core/types';
import type { HistoryRead } from './history-upstream.js';

/**
 * What a restart should retain, decided from the collector's durable latest
 * state.
 *
 * The seat cache (`RESULTS_CACHE_PATH`) is the collector's diff baseline, not a
 * payload: it carries electorates and no party vote or party lists, which is
 * enough to draw a map and not enough to draw seats, parties or candidates. It
 * is also the *only* thing a restart could recover once the Commission's media
 * feed stops answering — after the 2026 preliminary count it 404s on every
 * path, so the collector publishes nothing and no scrape replaces the preload.
 * The dashboard then waited for results that had been sitting in SQLite since
 * the count finished.
 *
 * `/history/latest` is the authoritative full payload that the history API
 * contract says a restart recovers electorates, parties and lists from, and it
 * lives on the same volume as this process. This decides whether to trust the
 * copy that came back: not when the read is degraded (an upstream that cannot
 * be verified is not an answer), not when it describes another cycle, and not
 * when a collector published while the read was in flight.
 */
export type DurableBootDecision =
  | { kind: 'loaded'; envelope: ResultsEnvelope }
  | {
      kind: 'ignored';
      reason: 'degraded' | 'empty' | 'other-cycle' | 'newer-publish';
    };

export function decideDurableBoot({
  latest,
  configuredYear,
  currentRevision,
}: {
  latest: HistoryRead<LatestStateRow> | null;
  /** The cycle this process serves; a row for another one is not a fallback. */
  configuredYear: string | number | null | undefined;
  /** Revision already retained (a collector published while this was in flight). */
  currentRevision: number | null;
}): DurableBootDecision {
  if (currentRevision !== null) {
    return { kind: 'ignored', reason: 'newer-publish' };
  }
  if (!latest || latest.unavailable) {
    return { kind: 'ignored', reason: 'degraded' };
  }

  const row = latest.data;
  if (!row?.payload?.electorateResults?.length) {
    return { kind: 'ignored', reason: 'empty' };
  }
  if (configuredYear && String(row.electionYear) !== String(configuredYear)) {
    return { kind: 'ignored', reason: 'other-cycle' };
  }

  return {
    kind: 'loaded',
    envelope: {
      payload: row.payload,
      electionYear:
        row.electionYear ?? (configuredYear ? String(configuredYear) : null),
      // Deliberately no revision. A revision retained at boot would gate the
      // next publish (`classifyResultsEnvelope` refuses an older one, and the
      // browser refuses one it has already seen), and a recreated SQLite volume
      // restarts revision numbering at 1 — so the first real count after a
      // rebuild would be thrown away as stale. The row's revision orders
      // history for clients; it is not this process's publish watermark.
      revision: null,
    },
  };
}
