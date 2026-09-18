import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  WebhookPayload,
} from '@election-night/core/types';

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

const mockConfig: { webhookUrl: string | undefined } = {
  webhookUrl: undefined,
};

vi.mock('./config.js', () => ({
  collectorConfig: mockConfig,
}));

function makeResult(overrides: Partial<Results> = {}): Results {
  return {
    electorateName: 'Test Electorate',
    partyVotes: [],
    candidateVotes: [],
    votesCounted: 10000,
    votePercentageCounted: 0.8,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 400,
      marginPercent: 0.04,
      predictionStatus: 'too-close',
    },
    marginOfError: 0.02,
    ...overrides,
  };
}

describe('computeDiff', () => {
  test('returns nulls for previous values when no previous result', async () => {
    const { computeDiff } = await import('./results.js');
    const current = makeResult();
    const diff = computeDiff(null, current);

    expect(diff.previousVotesCounted).toBeNull();
    expect(diff.previousPercentageCounted).toBeNull();
    expect(diff.previousMargin).toBeNull();
    expect(diff.leaderChanged).toBe(false);
    expect(diff.predictionStatusChanged).toBe(false);
    expect(diff.previousLeaderName).toBeNull();
  });

  test('detects no changes when results are identical', async () => {
    const { computeDiff } = await import('./results.js');
    const current = makeResult();
    const previous = makeResult();
    const diff = computeDiff(previous, current);

    expect(diff.previousVotesCounted).toBe(10000);
    expect(diff.currentVotesCounted).toBe(10000);
    expect(diff.leaderChanged).toBe(false);
    expect(diff.predictionStatusChanged).toBe(false);
  });

  test('detects leader change', async () => {
    const { computeDiff } = await import('./results.js');
    const previous = makeResult();
    const current = makeResult({
      leaders: {
        ...previous.leaders,
        leadingCandidateParty: 'Labour Party',
      },
    });
    const diff = computeDiff(previous, current);

    expect(diff.leaderChanged).toBe(true);
    expect(diff.previousLeaderParty).toBe('National Party');
  });

  test('detects prediction status change', async () => {
    const { computeDiff } = await import('./results.js');
    const previous = makeResult();
    const current = makeResult({
      leaders: {
        ...previous.leaders,
        predictionStatus: 'projected',
      },
    });
    const diff = computeDiff(previous, current);

    expect(diff.predictionStatusChanged).toBe(true);
    expect(diff.previousPredictionStatus).toBe('too-close');
    expect(diff.currentPredictionStatus).toBe('projected');
  });

  test('detects vote count change', async () => {
    const { computeDiff } = await import('./results.js');
    const previous = makeResult();
    const current = makeResult({ votesCounted: 15000 });
    const diff = computeDiff(previous, current);

    expect(diff.previousVotesCounted).toBe(10000);
    expect(diff.currentVotesCounted).toBe(15000);
  });
});

describe('determineWebhookEvents', () => {
  test('returns empty when there is no previous result (first scrape)', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const diff = computeDiff(null, makeResult());
    expect(determineWebhookEvents(diff)).toEqual([]);
  });

  test('returns result_updated when votes counted changed', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const diff = computeDiff(makeResult(), makeResult({ votesCounted: 15000 }));
    expect(determineWebhookEvents(diff)).toContain('result_updated');
  });

  test('returns result_updated when percentage counted changed', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const diff = computeDiff(
      makeResult(),
      makeResult({ votePercentageCounted: 0.9 })
    );
    expect(determineWebhookEvents(diff)).toContain('result_updated');
  });

  test('returns prediction_changed when status changes', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const previous = makeResult();
    const current = makeResult({
      leaders: { ...previous.leaders, predictionStatus: 'likely' },
    });
    const diff = computeDiff(previous, current);
    expect(determineWebhookEvents(diff)).toContain('prediction_changed');
  });

  test('returns leader_change when leading party changes', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const previous = makeResult();
    const current = makeResult({
      leaders: {
        ...previous.leaders,
        leadingCandidateParty: 'Labour Party',
      },
    });
    const diff = computeDiff(previous, current);
    expect(determineWebhookEvents(diff)).toContain('leader_change');
  });

  test('returns count_completed when reaching 100%', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const diff = computeDiff(
      makeResult({ votePercentageCounted: 0.95 }),
      makeResult({ votePercentageCounted: 1.0 })
    );
    expect(determineWebhookEvents(diff)).toContain('count_completed');
  });

  test('does not return count_completed if already at 100%', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const diff = computeDiff(
      makeResult({ votePercentageCounted: 1.0 }),
      makeResult({ votePercentageCounted: 1.0 })
    );
    expect(determineWebhookEvents(diff)).not.toContain('count_completed');
  });

  test('returns multiple events when several things changed', async () => {
    const { computeDiff, determineWebhookEvents } =
      await import('./results.js');
    const previous = makeResult({ votePercentageCounted: 0.8 });
    const current = makeResult({
      votesCounted: 20000,
      votePercentageCounted: 1.0,
      leaders: {
        leadingCandidate: 'Jones, Mary',
        leadingCandidateParty: 'Labour Party',
        secondCandidate: 'Smith, John',
        secondCandidateParty: 'National Party',
        margin: 200,
        marginPercent: 0.01,
        predictionStatus: 'projected',
      },
    });
    const diff = computeDiff(previous, current);
    const events = determineWebhookEvents(diff);

    expect(events).toContain('result_updated');
    expect(events).toContain('prediction_changed');
    expect(events).toContain('leader_change');
    expect(events).toContain('count_completed');
  });
});

describe('sendWebhook', () => {
  beforeEach(() => {
    mockConfig.webhookUrl = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('posts correct payload to webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://hooks.example.com/webhook';
    mockConfig.webhookUrl = url;

    const { computeDiff, sendWebhook } = await import('./results.js');

    const result = makeResult();
    const testDiff = computeDiff(
      makeResult({ votesCounted: 5000 }),
      makeResult({ votesCounted: 10000 })
    );

    await sendWebhook('result_updated', result, testDiff);

    const callBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    ) as WebhookPayload;

    expect(callBody.event).toBe('result_updated');
    expect(callBody.electorateName).toBe('Test Electorate');
    expect(callBody.timestamp).toBeGreaterThan(0);
    expect(callBody.result).toEqual(result);
    expect(callBody.diff.currentVotesCounted).toBe(10000);
    expect(callBody.diff.previousVotesCounted).toBe(5000);

    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      body: expect.any(String),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  test('does nothing when webhookUrl is not set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { computeDiff, sendWebhook } = await import('./results.js');
    const result = makeResult();
    const diff = computeDiff(makeResult(), result);

    await sendWebhook('result_updated', result, diff);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not throw when POST fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    mockConfig.webhookUrl = 'https://hooks.example.com/webhook';

    const { computeDiff, sendWebhook } = await import('./results.js');
    const result = makeResult();
    const diff = computeDiff(makeResult(), result);

    await expect(
      sendWebhook('result_updated', result, diff)
    ).resolves.toBeUndefined();
  });
});

describe('processResults', () => {
  beforeEach(() => {
    mockConfig.webhookUrl = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fires no webhooks when there is no previous snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    mockConfig.webhookUrl = 'https://hooks.example.com/webhook';

    const { processResults } = await import('./results.js');
    await processResults(
      [makeResult({ electorateName: 'Auckland Central' })],
      []
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fires webhooks for changes between the previous snapshot and now', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    mockConfig.webhookUrl = 'https://hooks.example.com/webhook';

    const { processResults } = await import('./results.js');

    const previous = [
      makeResult({
        electorateName: 'Auckland Central',
        votesCounted: 5000,
        votePercentageCounted: 0.5,
        leaders: {
          leadingCandidate: 'Smith, John',
          leadingCandidateParty: 'National Party',
          secondCandidate: 'Jones, Mary',
          secondCandidateParty: 'Labour Party',
          margin: 200,
          marginPercent: 0.04,
          predictionStatus: 'too-close',
        },
      }),
    ];

    await processResults(
      [
        makeResult({
          electorateName: 'Auckland Central',
          votesCounted: 10000,
          votePercentageCounted: 0.8,
          leaders: {
            leadingCandidate: 'Jones, Mary',
            leadingCandidateParty: 'Labour Party',
            secondCandidate: 'Smith, John',
            secondCandidateParty: 'National Party',
            margin: 150,
            marginPercent: 0.015,
            predictionStatus: 'leaning',
          },
        }),
      ],
      previous
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls.map(
      (c) =>
        (JSON.parse((c[1] as RequestInit).body as string) as WebhookPayload)
          .event
    );
    expect(calls).toContain('result_updated');
    expect(calls).toContain('prediction_changed');
    expect(calls).toContain('leader_change');
  });

  test('fires count_completed when an electorate reaches 100%', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    mockConfig.webhookUrl = 'https://hooks.example.com/webhook';

    const { processResults } = await import('./results.js');

    await processResults(
      [
        makeResult({
          electorateName: 'Wellington Central',
          votesCounted: 32000,
          votePercentageCounted: 1.0,
        }),
      ],
      [
        makeResult({
          electorateName: 'Wellington Central',
          votesCounted: 30000,
          votePercentageCounted: 0.95,
        }),
      ]
    );

    const events = fetchMock.mock.calls.map(
      (c) =>
        (JSON.parse((c[1] as RequestInit).body as string) as WebhookPayload)
          .event
    );
    expect(events).toContain('count_completed');
    expect(events).toContain('result_updated');
  });

  test('does not fire webhooks when nothing changed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    mockConfig.webhookUrl = 'https://hooks.example.com/webhook';

    const { processResults } = await import('./results.js');
    const result = makeResult({ electorateName: 'Dunedin' });

    await processResults([result], [result]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
