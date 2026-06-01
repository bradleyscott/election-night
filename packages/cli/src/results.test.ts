import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

const mockConfig: {
  cachePaths: { electoralResults: string };
  webhooks: {
    newPredictionWebhookUrl: string;
    leaderChangeWebhookUrl: string;
    updatedResultWebhookUrl: string | undefined;
  };
} = {
  cachePaths: { electoralResults: '' },
  webhooks: {
    newPredictionWebhookUrl: '',
    leaderChangeWebhookUrl: '',
    updatedResultWebhookUrl: undefined,
  },
};

vi.mock('@election-night/core/config', () => ({
  config: mockConfig,
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
      isPredictedWinner: false,
    },
    marginOfError: 0.02,
    ...overrides,
  };
}

describe('results', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'election-night-test-'));
    mockConfig.cachePaths.electoralResults = join(tmpDir, 'results.json');
    mockConfig.webhooks.newPredictionWebhookUrl = '';
    mockConfig.webhooks.leaderChangeWebhookUrl = '';
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('cacheResults writes to disk', async () => {
    const { cacheResults } = await import('./results.js');
    const result = makeResult({ electorateName: 'Test' });

    cacheResults([result]);

    expect(existsSync(mockConfig.cachePaths.electoralResults)).toBe(true);
    const written = JSON.parse(
      readFileSync(mockConfig.cachePaths.electoralResults, 'utf-8')
    );
    expect(written).toHaveLength(1);
    expect(written[0].electorateName).toBe('Test');
  });

  test('cacheResults overwrites previous cache', async () => {
    const { cacheResults } = await import('./results.js');
    cacheResults([makeResult({ electorateName: 'First' })]);
    cacheResults([makeResult({ electorateName: 'Second' })]);

    const written = JSON.parse(
      readFileSync(mockConfig.cachePaths.electoralResults, 'utf-8')
    );
    expect(written).toHaveLength(1);
    expect(written[0].electorateName).toBe('Second');
  });

  test('hasLeaderChanged detects no change for cached result', async () => {
    const { cacheResults, hasLeaderChanged } = await import('./results.js');
    const result = makeResult();

    cacheResults([result]);
    const changed = hasLeaderChanged(result);

    expect(changed).toBe(false);
  });

  test('hasLeaderChanged detects a leader change', async () => {
    const { cacheResults, hasLeaderChanged } = await import('./results.js');
    const result = makeResult();

    cacheResults([result]);

    const updated = makeResult({
      leaders: {
        ...result.leaders,
        leadingCandidateParty: 'Labour Party',
      },
    });
    const changed = hasLeaderChanged(updated);

    expect(changed).toBe(true);
  });

  test('hasNewPrediction detects a new prediction', async () => {
    const { cacheResults, hasNewPrediction } = await import('./results.js');
    const result = makeResult();

    cacheResults([result]);

    const updated = makeResult({
      leaders: {
        ...result.leaders,
        isPredictedWinner: true,
      },
    });
    const predicted = hasNewPrediction(updated);

    expect(predicted).toBe(true);
  });

  test('hasNewPrediction returns false when prediction status matches', async () => {
    const { cacheResults, hasNewPrediction } = await import('./results.js');
    const result = makeResult({
      leaders: {
        leadingCandidate: 'Smith, John',
        leadingCandidateParty: 'National Party',
        secondCandidate: 'Jones, Mary',
        secondCandidateParty: 'Labour Party',
        margin: 400,
        marginPercent: 0.04,
        isPredictedWinner: true,
      },
    });

    cacheResults([result]);
    const predicted = hasNewPrediction(result);

    expect(predicted).toBe(false);
  });

  test('processLeaderChange posts to webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://hooks.example.com/leader-change';
    mockConfig.webhooks.leaderChangeWebhookUrl = url;

    const { processLeaderChange } = await import('./results.js');
    const result = makeResult();
    await processLeaderChange(result);

    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      body: JSON.stringify({ ...result }),
      headers: { 'Content-Type': 'application/json' },
    });

    vi.unstubAllGlobals();
  });

  test('processNewPrediction posts to webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://hooks.example.com/new-prediction';
    mockConfig.webhooks.newPredictionWebhookUrl = url;

    const { processNewPrediction } = await import('./results.js');
    const result = makeResult();
    await processNewPrediction(result);

    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      body: JSON.stringify({ ...result }),
      headers: { 'Content-Type': 'application/json' },
    });

    vi.unstubAllGlobals();
  });
});
