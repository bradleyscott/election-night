import { describe, expect, test } from 'vitest';
import { decideDurableBoot } from './durable-state.js';
import type { LatestStateRow } from '@election-night/core/history';
import type { HistoryRead } from './history-upstream.js';

function row(overrides: Partial<LatestStateRow> = {}): LatestStateRow {
  return {
    electionYear: '2026',
    revision: 3,
    payload: {
      electorateResults: [
        {
          electorateName: 'Auckland Central',
          candidateVotes: [],
          partyVotes: [],
          votesCounted: 24061,
          votePercentageCounted: 100,
          totalVotes: 24061,
          leadingCandidate: null,
          leadingParty: null,
          lead: 0,
          candidates: [],
          leaders: {
            leadingCandidate: null,
            leadingParty: null,
            runnerUpCandidate: null,
            margin: 0,
          },
        } as unknown as LatestStateRow['payload']['electorateResults'][number],
      ],
      partyVote: [
        {
          candidate: 'Labour Party',
          votes: 100,
          seats: 1,
          electorateSeats: 1,
          listSeats: 0,
          percentage: 50,
        } as unknown as LatestStateRow['payload']['partyVote'][number],
      ],
      partyLists: [
        {
          party: 'Labour Party',
          candidate: 'Somebody',
          rank: 1,
          distanceFromCut: 3,
          elected: true,
        } as unknown as LatestStateRow['payload']['partyLists'][number],
      ],
    },
    source: 'NZ Election XML Feed',
    observedAt: '2026-11-08T08:18:32.266Z',
    phase: 'counting',
    coverage: null,
    modelVersion: 1,
    configVersion: '2026',
    updatedAt: '2026-11-08T08:18:33.000Z',
    ...overrides,
  };
}

function read(
  data: LatestStateRow | null,
  extra: Partial<HistoryRead<LatestStateRow>> = {}
): HistoryRead<LatestStateRow> {
  return {
    data,
    state: 'verified',
    verifiedAt: Date.now(),
    unavailable: false,
    ...extra,
  };
}

describe('decideDurableBoot', () => {
  // The whole point: after a restart the server holds the seat cache only, which
  // has no party vote and no party lists, so Seats and Parties wait for results
  // that are already in SQLite.
  test('recovers the full payload, parties and lists included', () => {
    const decision = decideDurableBoot({
      latest: read(row()),
      configuredYear: '2026',
      currentRevision: null,
    });

    expect(decision.kind).toBe('loaded');
    if (decision.kind !== 'loaded') return;
    // No revision: retaining one would make the next publish look stale after
    // a recreated volume (revisions restart at 1), so the row must not set the
    // process's publish watermark.
    expect(decision.envelope.revision).toBeNull();
    expect(decision.envelope.electionYear).toBe('2026');
    expect(decision.envelope.payload.partyVote).toHaveLength(1);
    expect(decision.envelope.payload.partyLists).toHaveLength(1);
  });

  test('keeps the seat cache when the history upstream cannot be verified', () => {
    const decision = decideDurableBoot({
      latest: read(null, { unavailable: true, reason: 'upstream-unreachable' }),
      configuredYear: '2026',
      currentRevision: null,
    });

    expect(decision).toEqual({ kind: 'ignored', reason: 'degraded' });
  });

  test('keeps the seat cache when there is no durable state yet', () => {
    // A read that never happened (the fetch threw) is degraded; a verified
    // absence — a preview with no collector — is simply empty.
    expect(
      decideDurableBoot({
        latest: null,
        configuredYear: '2026',
        currentRevision: null,
      })
    ).toEqual({ kind: 'ignored', reason: 'degraded' });

    expect(
      decideDurableBoot({
        latest: read(null),
        configuredYear: '2026',
        currentRevision: null,
      })
    ).toEqual({ kind: 'ignored', reason: 'empty' });
  });

  test('refuses a row for another cycle', () => {
    const decision = decideDurableBoot({
      latest: read(row({ electionYear: '2023' })),
      configuredYear: '2026',
      currentRevision: null,
    });

    expect(decision).toEqual({ kind: 'ignored', reason: 'other-cycle' });
  });

  test('does not walk back a publish that landed while the read was in flight', () => {
    const decision = decideDurableBoot({
      latest: read(row({ revision: 2 })),
      configuredYear: '2026',
      currentRevision: 7,
    });

    expect(decision).toEqual({ kind: 'ignored', reason: 'newer-publish' });
  });
});
