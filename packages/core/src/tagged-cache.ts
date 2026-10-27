/**
 * A cache file that belongs to one election cycle, and the rules for reading
 * it back.
 *
 * Three caches in this repo persist JSON on the Fly volume: the collector's
 * diff baseline (`RESULTS_CACHE_PATH`), the dashboard server's preload of the
 * same file (`CACHE_PATH` — the same path in the combined image), and the feed
 * events (`FEED_CACHE_PATH`). All three outlive a cycle, so all three are
 * tagged with the cycle they describe:
 *
 *     { "electionYear": "2026", "events": [ … ] }
 *
 * Without the tag, a 2023 replay's feed would open the 2026 feed and a 2023
 * diff baseline would turn every seat into a spurious leader change at 7pm on
 * the next election night. A file that cannot be attributed to a cycle is
 * therefore ignored — except by a caller that does not know which cycle it is
 * serving at all (`ELECTION_YEAR` unset), which is the only case where the
 * legacy bare array is safe to use.
 *
 * This lives in core rather than in either process because the reader and the
 * writer must agree on the envelope, and the two processes run from the same
 * file in production.
 */

/** What reading a cache file produced: the items, or why they were skipped. */
export type TaggedCacheRead<T> =
  | {
      ok: true;
      items: T[];
      /**
       * The cycle the file records. `null` for a legacy untagged array, which
       * is only ever returned when the caller did not know its own cycle.
       */
      electionYear: string | null;
    }
  | {
      ok: false;
      /**
       * A sentence fragment describing why the file was skipped, e.g.
       * `belongs to the 2023 election, not 2026`. Callers prepend their own
       * noun and the path, so the operator's log names the file.
       */
      reason: string;
    };

/**
 * Read `items` out of a tagged cache file.
 *
 * `key` is the envelope's array field (`results`, `events`), `payloadNoun`
 * names the payload in the skip reason, and `expectedYear` is the cycle the
 * caller is serving. A bare array is accepted only when `expectedYear` is
 * undefined — the caller cannot attribute it to a cycle, but it also cannot
 * claim it belongs to the wrong one.
 */
export function readTaggedCache<T>(options: {
  raw: string;
  key: string;
  payloadNoun: string;
  expectedYear?: string;
}): TaggedCacheRead<T> {
  const { raw, key, payloadNoun, expectedYear } = options;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'file is not valid JSON' };
  }

  if (Array.isArray(parsed)) {
    // Legacy shape, written before the envelope existed. It names no cycle, so
    // it is only usable by a process that is not serving a particular one.
    if (expectedYear === undefined) {
      return { ok: true, items: parsed as T[], electionYear: null };
    }
    return {
      ok: false,
      reason: `has no election year and ${expectedYear} is the cycle being served`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: `is not a ${payloadNoun} payload` };
  }

  const envelope = parsed as Record<string, unknown>;
  if (!Array.isArray(envelope[key])) {
    return { ok: false, reason: `is not a ${payloadNoun} payload` };
  }
  if (typeof envelope.electionYear !== 'string') {
    return { ok: false, reason: 'has no election year' };
  }
  if (expectedYear !== undefined && envelope.electionYear !== expectedYear) {
    return {
      ok: false,
      reason: `belongs to the ${envelope.electionYear} election, not ${expectedYear}`,
    };
  }

  return {
    ok: true,
    items: envelope[key] as T[],
    electionYear: envelope.electionYear,
  };
}

/**
 * Serialise `items` for disk, tagged with the cycle when the writer knows which
 * one it serves. With no cycle there is no honest tag to write, so the legacy
 * bare array is kept and the reader applies the mirror of the same rule.
 */
export function serializeTaggedCache<T>(
  items: T[],
  key: string,
  electionYear?: string
): string {
  const payload: Record<string, unknown> | T[] = electionYear
    ? { electionYear, [key]: items }
    : items;
  return JSON.stringify(payload, null, 2);
}
