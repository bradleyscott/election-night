import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  PriorWinnersResponse,
  ResultsForYear,
} from '@election-night/core/history';
import type { VotingPlacesResponse } from '@election-night/core/voting-places';
import { serveApi } from './api.js';
import type {
  HistoryRead,
  HistorySource,
  HistoryState,
  HistoryFailureReason,
} from './history-upstream.js';

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function fakeResponse(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: '' };
  const res = {
    setHeader(name: string, value: string | number) {
      captured.headers[name.toLowerCase()] = String(value);
    },
    writeHead(status: number, headers?: Record<string, string | number>) {
      captured.status = status;
      for (const [name, value] of Object.entries(headers ?? {})) {
        captured.headers[name.toLowerCase()] = String(value);
      }
      return res;
    },
    end(chunk?: unknown) {
      captured.body = chunk === undefined ? '' : String(chunk);
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

function read<T>(
  data: T | null,
  overrides: Partial<{
    state: HistoryState;
    verifiedAt: number | null;
    reason: HistoryFailureReason;
    unavailable: boolean;
  }> = {}
): HistoryRead<T> {
  return {
    data,
    state: overrides.state ?? 'verified',
    verifiedAt:
      overrides.verifiedAt === undefined
        ? 1_700_000_000_000
        : overrides.verifiedAt,
    reason: overrides.reason,
    unavailable: overrides.unavailable ?? false,
  };
}

function fakeSource(overrides: Partial<HistorySource> = {}): HistorySource {
  const unavailable = <T>() =>
    read<T>(null, {
      state: 'stale',
      verifiedAt: null,
      reason: 'upstream-unreachable',
      unavailable: true,
    });
  return {
    snapshotMetas: async () => read([]),
    electorateHistory: async () => read<ElectorateHistoryPoint[]>([]),
    partyVoteHistory: async () => read<PartyVoteHistoryPoint[]>([]),
    priorWinners: async () => unavailable<PriorWinnersResponse>(),
    resultsForYear: async () => unavailable<ResultsForYear>(),
    votingPlaces: async () => unavailable<VotingPlacesResponse>(),
    clearCache: () => {},
    ...overrides,
  };
}

/** A minimal valid party-vote point, so the body assertion exercises a real row. */
function partyPoint(snapshotId: number): PartyVoteHistoryPoint {
  return {
    snapshotId,
    startedAt: '2026-11-07T07:00:00.000Z',
    completedAt: null,
    votesCounted: 100,
    votePctCounted: 10,
    parties: [],
  };
}

/** A minimal valid electorate-history point. */
function electoratePoint(snapshotId: number): ElectorateHistoryPoint {
  return {
    snapshotId,
    startedAt: '2026-11-07T07:00:00.000Z',
    completedAt: null,
    votesCounted: 100,
    votePctCounted: 10,
    leadingCandidate: null,
    leadingParty: null,
    margin: null,
    marginPct: null,
    candidates: [],
    partyVotes: [],
  };
}

async function call(
  path: string,
  source: HistorySource
): Promise<{ handled: boolean; captured: Captured }> {
  const { res, captured } = fakeResponse();
  const handled = await serveApi(
    {} as IncomingMessage,
    res,
    new URL(`http://localhost${path}`),
    source
  );
  return { handled, captured };
}

const ISO_VERIFIED = new Date(1_700_000_000_000).toISOString();

describe('history API responses', () => {
  it('returns a verified array body and headers for party history', async () => {
    const { handled, captured } = await call(
      '/api/history/party-votes',
      fakeSource({
        partyVoteHistory: async () => read([partyPoint(1)]),
      })
    );

    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
    expect(JSON.parse(captured.body)).toEqual([partyPoint(1)]);
    expect(captured.headers['cache-control']).toBe('no-store');
    expect(captured.headers['x-election-history-state']).toBe('verified');
    expect(captured.headers['x-election-history-verified-at']).toBe(
      ISO_VERIFIED
    );
    expect(captured.headers['x-election-history-reason']).toBeUndefined();
  });

  it('marks a cached read as cached without claiming a new verification', async () => {
    const { captured } = await call(
      '/api/history/party-votes',
      fakeSource({
        partyVoteHistory: async () =>
          read([partyPoint(1)], { state: 'cached' }),
      })
    );

    expect(captured.status).toBe(200);
    expect(captured.headers['x-election-history-state']).toBe('cached');
    expect(captured.headers['x-election-history-verified-at']).toBe(
      ISO_VERIFIED
    );
  });

  it('serves a stale value with its state and bounded reason', async () => {
    const { captured } = await call(
      '/api/history/electorate/Mt%20Roskill',
      fakeSource({
        electorateHistory: async () =>
          read([electoratePoint(66)], {
            state: 'stale',
            reason: 'upstream-unreachable',
          }),
      })
    );

    expect(captured.status).toBe(200);
    expect(JSON.parse(captured.body)).toEqual([electoratePoint(66)]);
    expect(captured.headers['x-election-history-state']).toBe('stale');
    expect(captured.headers['x-election-history-reason']).toBe(
      'upstream-unreachable'
    );
  });

  it('returns a structured 503 when no usable history exists', async () => {
    const unavailable = await call(
      '/api/history/party-votes',
      fakeSource({
        partyVoteHistory: async () =>
          read([], {
            state: 'stale',
            verifiedAt: 1_600_000_000_000,
            reason: 'stale-too-old',
            unavailable: true,
          }),
      })
    );

    expect(unavailable.captured.status).toBe(503);
    expect(JSON.parse(unavailable.captured.body)).toMatchObject({
      state: 'stale',
      reason: 'stale-too-old',
    });
    expect(unavailable.captured.headers['x-election-history-state']).toBe(
      'stale'
    );
    expect(unavailable.captured.headers['cache-control']).toBe('no-store');
  });

  it('keeps a legitimate empty array a successful answer', async () => {
    const { captured } = await call(
      '/api/history/electorate/Empty',
      fakeSource({ electorateHistory: async () => read([]) })
    );

    expect(captured.status).toBe(200);
    expect(JSON.parse(captured.body)).toEqual([]);
  });

  it('returns 404 for an archive year the collector cannot serve', async () => {
    const { captured } = await call(
      '/api/history/results/2014',
      fakeSource({ resultsForYear: async () => read<ResultsForYear>(null) })
    );

    expect(captured.status).toBe(404);
    expect(JSON.parse(captured.body)).toHaveProperty('error');
  });

  it('returns 404 for a cycle with no voting-place listing', async () => {
    const { captured } = await call(
      '/api/history/voting-places/Mt%20Albert',
      fakeSource({
        votingPlaces: async () => read<VotingPlacesResponse>(null),
      })
    );

    expect(captured.status).toBe(404);
  });

  it('returns 503 rather than 404 when voting places are unavailable', async () => {
    const { captured } = await call(
      '/api/history/voting-places/Mt%20Albert',
      fakeSource()
    );

    expect(captured.status).toBe(503);
    expect(JSON.parse(captured.body)).toMatchObject({
      reason: 'upstream-unreachable',
    });
  });

  it('returns 503 when prior winners cannot be derived', async () => {
    const { captured } = await call('/api/history/prior-winners', fakeSource());

    expect(captured.status).toBe(503);
  });

  it('returns false for non-history routes so static serving can continue', async () => {
    const { handled } = await call('/about', fakeSource());
    expect(handled).toBe(false);
  });
});
