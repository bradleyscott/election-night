import type { FeedEvent, FeedEventType } from '@election-night/core/types';

/**
 * The feed's durable read, and the judgement about adopting one.
 *
 * Feed events are the only state the dashboard keeps that had no way out: the
 * collector's diff builds them, this process holds them in memory and writes
 * `FEED_CACHE_PATH`, and browsers only ever receive them over the socket on
 * connect. That is enough on a machine with a volume — production reloads its
 * cache at boot — but a PR preview has no volume and no collector, so its Live
 * Feed panel could only ever say "Awaiting results" while every other page
 * showed the current count. A page that contradicts itself reads as a bug.
 *
 * So the retained events get an HTTP read (`GET /api/feed-events`), and a
 * process that boots with none adopts them from its configured upstream. Same
 * shape as the results recovery: the response names its cycle, an empty or
 * foreign one is refused rather than shown, and nothing is invented — a
 * preview renders the events production actually holds, not a fixture.
 */

export const FEED_EVENTS_PATH = '/feed-events';

/** What `GET /api/feed-events` answers. */
export type FeedEventsBody = {
  electionYear: string | null;
  events: FeedEvent[];
  updatedAt: string | null;
};

const FEED_EVENT_TYPES: ReadonlySet<string> = new Set<FeedEventType>([
  'result_updated',
  'prediction_called',
  'leader_change',
  'count_completed',
]);

export function buildFeedEventsBody(
  events: FeedEvent[],
  electionYear: string | number | null | undefined
): FeedEventsBody {
  return {
    electionYear:
      electionYear === null || electionYear === undefined
        ? null
        : String(electionYear),
    events,
    updatedAt:
      events.length > 0
        ? new Date(events[events.length - 1].timestamp).toISOString()
        : null,
  };
}

/**
 * Everything the panel draws from, so a malformed body is refused wholesale
 * rather than half-rendered. Deliberately strict about the fields a reader
 * sees: an event with no summary or no timestamp is not an event.
 */
function isFeedEvent(value: unknown): value is FeedEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<FeedEvent>;
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.timestamp === 'number' &&
    Number.isFinite(e.timestamp) &&
    typeof e.type === 'string' &&
    FEED_EVENT_TYPES.has(e.type) &&
    typeof e.electorateName === 'string' &&
    typeof e.summary === 'string' &&
    typeof e.commentary === 'string' &&
    !!e.diff &&
    typeof e.diff === 'object'
  );
}

/** Parse an upstream body, or `null` when it is not one we would render. */
export function parseFeedEventsBody(raw: unknown): FeedEventsBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Partial<FeedEventsBody>;
  if (!Array.isArray(body.events)) return null;
  if (!body.events.every(isFeedEvent)) return null;
  return {
    electionYear:
      body.electionYear === null || body.electionYear === undefined
        ? null
        : String(body.electionYear),
    events: body.events,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
  };
}

export type FeedRecoveryDecision =
  | { kind: 'adopted'; events: FeedEvent[] }
  | {
      kind: 'ignored';
      reason: 'has-local' | 'other-cycle' | 'empty' | 'invalid';
    };

/**
 * Whether to take the upstream's events.
 *
 * `has-local` comes first: a machine with its own feed is authoritative, so a
 * preview pointed at production can never overwrite what its own collector
 * published. `other-cycle` refuses a finished cycle's commentary on a volume
 * that outlived it — the same rule the on-disk cache applies.
 */
export function decideFeedRecovery({
  body,
  configuredYear,
  localCount,
}: {
  /** The parsed upstream body; `null` when the read failed or was invalid. */
  body: FeedEventsBody | null;
  configuredYear: string | number | null | undefined;
  /** Events already held in this process. */
  localCount: number;
}): FeedRecoveryDecision {
  if (localCount > 0) return { kind: 'ignored', reason: 'has-local' };
  if (!body) return { kind: 'ignored', reason: 'invalid' };

  if (configuredYear) {
    if (!body.electionYear) return { kind: 'ignored', reason: 'other-cycle' };
    if (String(body.electionYear) !== String(configuredYear)) {
      return { kind: 'ignored', reason: 'other-cycle' };
    }
  }

  if (body.events.length === 0) return { kind: 'ignored', reason: 'empty' };
  return { kind: 'adopted', events: body.events };
}
