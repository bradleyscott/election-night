import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
} from '@election-night/core/types';
import { createResultsDb } from './query.js';

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

function makeResult(
  votes: number,
  electorateName = 'Test Electorate'
): Results {
  return {
    electorateName,
    partyVotes: [
      { candidate: 'National Party', votes },
      { candidate: 'Labour Party', votes: Math.floor(votes * 0.9) },
    ],
    candidateVotes: [
      { candidate: 'Smith, John', party: 'National Party', votes: votes + 200 },
      { candidate: 'Jones, Mary', party: 'Labour Party', votes },
    ],
    votesCounted: votes * 2,
    votePercentageCounted: 0.5,
    leaders: {
      leadingCandidate: 'Smith, John',
      leadingCandidateParty: 'National Party',
      secondCandidate: 'Jones, Mary',
      secondCandidateParty: 'Labour Party',
      margin: 200,
      marginPercent: 0.02,
      predictionStatus: 'leaning',
    },
    marginOfError: 0.02,
  };
}

describe('results DB queries', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'results-db-test-'));
    dbPath = join(tmpDir, 'test.db');
    const { openDb, writeResults, closeDb } = await import('./db.js');
    openDb(dbPath);
    // A DB holding both cycles, to prove history is scoped to one of them.
    writeResults([makeResult(5000, 'Wellington Central')], [], [], '2023');
    writeResults([makeResult(6000)], [], [], '2026');
    writeResults([makeResult(7000)], [], [], '2026');
    closeDb();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('serves snapshots for the configured cycle only', () => {
    const db = createResultsDb({ dbPath, electionYear: '2026' });
    expect(db.snapshotMetas()).toHaveLength(2);
    db.close();
  });

  test('scopes to another cycle when one is requested explicitly', () => {
    const db = createResultsDb({ dbPath, electionYear: '2026' });
    expect(db.snapshotMetas('2023')).toHaveLength(1);
    db.close();
  });

  test('serves electorate history with candidates and party votes', () => {
    const db = createResultsDb({ dbPath, electionYear: '2026' });
    const history = db.electorateHistory('Test Electorate');

    expect(history).toHaveLength(2);
    expect(history[0]!.candidates[0]!.candidate).toBe('Smith, John');
    expect(history[0]!.partyVotes[0]!.party).toBe('National Party');
    db.close();
  });

  test('serves party-vote history', () => {
    const db = createResultsDb({ dbPath, electionYear: '2026' });
    expect(db.partyVoteHistory()).toHaveLength(2);
    db.close();
  });

  test('returns nothing for a cycle that has no snapshots', () => {
    const db = createResultsDb({ dbPath, electionYear: '2030' });
    expect(db.snapshotMetas()).toEqual([]);
    expect(db.latestPayload()).toBeNull();
    db.close();
  });

  test('returns empty results when the DB does not exist yet', () => {
    const db = createResultsDb({
      dbPath: join(tmpDir, 'missing.db'),
      electionYear: '2026',
    });
    expect(db.isAvailable()).toBe(false);
    expect(db.snapshotMetas()).toEqual([]);
    expect(db.partyVoteHistory()).toEqual([]);
    expect(db.latestPayload()).toBeNull();
    db.close();
  });

  test('latestPayload reconstructs the newest snapshot in full', () => {
    const db = createResultsDb({ dbPath, electionYear: '2026' });
    const latest = db.latestPayload();

    expect(latest).not.toBeNull();
    // Three electorates were written for 2026 (two snapshots, one electorate
    // each): the newest snapshot holds 7000-vote rows only.
    expect(latest!.electorateResults).toHaveLength(1);
    const result = latest!.electorateResults[0]!;
    expect(result.votesCounted).toBe(14000);
    expect(result.votePercentageCounted).toBe(0.5);

    // The fields the webhook diff reads must survive the round trip.
    expect(result.leaders.leadingCandidate).toBe('Smith, John');
    expect(result.leaders.leadingCandidateParty).toBe('National Party');
    expect(result.leaders.predictionStatus).toBe('leaning');
    expect(result.leaders.margin).toBe(200);
    expect(result.leaders.marginPercent).toBeCloseTo(0.02);
    expect(result.marginOfError).toBeCloseTo(0.02);

    // Candidate votes keep their party so seat maths can be recomputed.
    expect(result.candidateVotes).toHaveLength(2);
    expect(result.candidateVotes[0]!.party).toBe('National Party');

    db.close();
  });

  test('latestPayload returns an empty payload shape when the snapshot has no parties', () => {
    const db = createResultsDb({ dbPath, electionYear: '2026' });
    const latest = db.latestPayload();

    // writeResults was called with no party vote / party list rows.
    expect(latest!.partyVote).toEqual([]);
    expect(latest!.partyLists).toEqual([]);
    db.close();
  });
});
