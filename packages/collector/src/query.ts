/**
 * Read-only queries over the collector's SQLite DB.
 *
 * `db.ts` owns the write path; this module is the read side. The dashboard
 * server uses it to serve `/api/history/*` and to rehydrate its live state on
 * boot, and the collector uses `latestPayload()` to get the previous snapshot
 * as its webhook diff baseline.
 *
 * Reads open their own read-only connection, so a query can never write.
 *
 * Every query is scoped to one election cycle (`ELECTION_YEAR`) so a volume
 * holding more than one cycle cannot blend 2023 rows into 2026 charts. Callers
 * may override the cycle per request to browse an archived election.
 */

import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import type {
  ElectorateHistoryPoint,
  PartyVoteHistoryPoint,
  SnapshotMeta,
} from '@election-night/core/history';
import type {
  ElectorateResults,
  PredictionStatus,
  ResultsPayload,
  WithLeaders,
  WithMarginOfError,
  WithParty,
  WithSeats,
  VotingResults,
} from '@election-night/core/types';
import type { PartyList, WithAdjustedRank } from '@election-night/core/types';
import { log } from './logger.js';

export type { ElectorateHistoryPoint, PartyVoteHistoryPoint, SnapshotMeta };

export type ElectorateResult = ElectorateResults &
  WithLeaders &
  WithMarginOfError;

export type ResultsDb = {
  /** All snapshots for the cycle, oldest first. */
  snapshotMetas(year?: string): SnapshotMeta[];
  /** Vote-count time series for one electorate. */
  electorateHistory(name: string, year?: string): ElectorateHistoryPoint[];
  /** Party vote time series across the cycle. */
  partyVoteHistory(year?: string): PartyVoteHistoryPoint[];
  /**
   * The newest written snapshot reconstructed as a full results payload.
   *
   * Returns null when the cycle has no snapshots yet (a DB that has not been
   * written, or one holding only other cycles). This doubles as the collector's
   * diff baseline — `payload.electorateResults` is exactly the previous cycle's
   * results.
   */
  latestPayload(year?: string): ResultsPayload | null;
  /** True when the DB file exists and can be read. */
  isAvailable(): boolean;
  close(): void;
};

/** `predicted_winner` is stored as an ordinal so history queries stay cheap. */
function predictionStatus(predictedWinner: number): PredictionStatus {
  switch (predictedWinner) {
    case 3:
      return 'projected';
    case 2:
      return 'likely';
    case 1:
      return 'leaning';
    default:
      return 'too-close';
  }
}

/** Snapshots are written with `''` for an unknown party; the API uses null. */
function partyOrUndefined(party: string | null): string | undefined {
  return party ? party : undefined;
}

export function createResultsDb(options: {
  dbPath: string;
  electionYear: string;
}): ResultsDb {
  const { dbPath, electionYear: configuredYear } = options;
  let db: Database.Database | null = null;
  let openedPath: string | undefined;

  /**
   * The DB file only appears once the collector has written its first
   * snapshot, so a missing file is a normal state, not an error — callers get
   * empty results until it shows up.
   */
  function handle(): Database.Database | null {
    if (db && openedPath === dbPath) return db;
    if (db) {
      db.close();
      db = null;
    }
    openedPath = dbPath;
    if (!existsSync(dbPath)) return null;
    db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');
    log.info(`Opened results DB (read-only) at ${dbPath}`);
    return db;
  }

  function year(requested?: string): string {
    return requested ?? configuredYear;
  }

  function getSnapshotMetas(
    conn: Database.Database,
    cycle: string
  ): SnapshotMeta[] {
    return conn
      .prepare(
        `SELECT id AS snapshotId, election_year AS electionYear,
                started_at AS startedAt, completed_at AS completedAt
         FROM scrape_snapshots
         WHERE election_year = ?
         ORDER BY started_at ASC`
      )
      .all(cycle) as SnapshotMeta[];
  }

  function getElectorateHistory(
    conn: Database.Database,
    name: string,
    cycle: string
  ): ElectorateHistoryPoint[] {
    const summaries = conn
      .prepare(
        `SELECT
           ss.id AS snapshotId,
           ss.election_year AS electionYear,
           ss.started_at AS startedAt,
           ss.completed_at AS completedAt,
           es.votes_counted AS votesCounted,
           es.vote_pct_counted AS votePctCounted,
           es.leading_candidate AS leadingCandidate,
           es.leading_party AS leadingParty,
           es.predicted_winner AS predictedWinner,
           es.margin AS margin,
           es.margin_pct AS marginPct,
           es.margin_of_error AS marginOfError
         FROM scrape_snapshots ss
         JOIN electorate_summary es ON es.scrape_id = ss.id
         WHERE es.electorate = ? AND ss.election_year = ?
         ORDER BY ss.started_at ASC`
      )
      .all(name, cycle) as Record<string, unknown>[];

    return summaries.map((row) => ({
      ...row,
      candidates: conn
        .prepare(
          `SELECT candidate, party, votes, is_predicted AS isPredicted
           FROM electorate_results
           WHERE scrape_id = ? AND electorate = ?
           ORDER BY votes DESC`
        )
        .all(row.snapshotId, name),
      partyVotes: conn
        .prepare(
          `SELECT party, votes
           FROM party_vote_results
           WHERE scrape_id = ? AND electorate = ?
           ORDER BY votes DESC`
        )
        .all(row.snapshotId, name),
    })) as ElectorateHistoryPoint[];
  }

  function getPartyVoteHistory(
    conn: Database.Database,
    cycle: string
  ): PartyVoteHistoryPoint[] {
    const snapshots = conn
      .prepare(
        `SELECT id AS snapshotId, election_year AS electionYear,
                started_at AS startedAt, completed_at AS completedAt
         FROM scrape_snapshots
         WHERE election_year = ?
         ORDER BY started_at ASC`
      )
      .all(cycle) as Record<string, unknown>[];

    return snapshots.map((snap) => {
      const snapshotId = snap.snapshotId as number;
      const parties = conn
        .prepare(
          `SELECT party, votes, seats,
                  electorate_seats AS electorateSeats, list_seats AS listSeats
           FROM party_vote_summary
           WHERE scrape_id = ?
           ORDER BY votes DESC`
        )
        .all(snapshotId);
      const counted = conn
        .prepare(
          `SELECT COALESCE(SUM(votes_counted), 0) AS votesCounted,
                  COALESCE(SUM(estimated_total_votes), 0) AS estimatedTotalVotes
           FROM electorate_summary
           WHERE scrape_id = ?`
        )
        .get(snapshotId) as Record<string, number>;
      return {
        ...snap,
        votesCounted: counted.votesCounted,
        votePctCounted:
          counted.estimatedTotalVotes > 0
            ? counted.votesCounted / counted.estimatedTotalVotes
            : 0,
        parties,
      };
    }) as PartyVoteHistoryPoint[];
  }

  function newestSnapshotId(
    conn: Database.Database,
    cycle: string
  ): number | null {
    const row = conn
      .prepare(
        `SELECT id FROM scrape_snapshots
         WHERE election_year = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(cycle) as { id: number } | undefined;
    return row?.id ?? null;
  }

  function getLatestPayload(
    conn: Database.Database,
    cycle: string
  ): ResultsPayload | null {
    const snapshotId = newestSnapshotId(conn, cycle);
    if (snapshotId === null) return null;

    const summaries = conn
      .prepare(
        `SELECT electorate AS electorateName,
                votes_counted AS votesCounted,
                vote_pct_counted AS votePctCounted,
                leading_candidate AS leadingCandidate,
                leading_party AS leadingParty,
                second_candidate AS secondCandidate,
                second_party AS secondParty,
                predicted_winner AS predictedWinner,
                margin, margin_pct AS marginPct,
                margin_of_error AS marginOfError
         FROM electorate_summary
         WHERE scrape_id = ?
         ORDER BY electorate ASC`
      )
      .all(snapshotId) as Record<string, unknown>[];

    const candidatesByElectorate = conn.prepare(
      `SELECT candidate, party, votes
       FROM electorate_results
       WHERE scrape_id = ? AND electorate = ?
       ORDER BY votes DESC`
    );
    const partyVotesByElectorate = conn.prepare(
      `SELECT party, votes
       FROM party_vote_results
       WHERE scrape_id = ? AND electorate = ?
       ORDER BY votes DESC`
    );

    const electorateResults: ElectorateResult[] = summaries.map((row) => {
      const electorateName = row.electorateName as string;
      const partyVotes = partyVotesByElectorate.all(
        snapshotId,
        electorateName
      ) as VotingResults[];

      return {
        electorateName,
        // Party votes are keyed by party name, matching the live pipeline.
        partyVotes: partyVotes.map((pv) => ({
          candidate: (pv as unknown as { party: string }).party,
          votes: pv.votes,
        })),
        candidateVotes: (
          candidatesByElectorate.all(
            snapshotId,
            electorateName
          ) as (VotingResults & { party: string })[]
        ).map((cv) => ({
          candidate: cv.candidate,
          votes: cv.votes,
          party: partyOrUndefined(cv.party),
        })) as (VotingResults & WithParty)[],
        votesCounted: row.votesCounted as number,
        votePercentageCounted: row.votePctCounted as number,
        leaders: {
          leadingCandidate: (row.leadingCandidate as string) ?? '',
          leadingCandidateParty: partyOrUndefined(
            row.leadingParty as string | null
          ),
          secondCandidate: (row.secondCandidate as string) ?? '',
          secondCandidateParty: partyOrUndefined(
            row.secondParty as string | null
          ),
          margin: (row.margin as number) ?? 0,
          marginPercent: (row.marginPct as number) ?? 0,
          predictionStatus: predictionStatus(row.predictedWinner as number),
        },
        marginOfError: (row.marginOfError as number) ?? 0,
      };
    });

    const partyVote = (
      conn
        .prepare(
          `SELECT party, votes, seats,
                  electorate_seats AS electorateSeats, list_seats AS listSeats
           FROM party_vote_summary
           WHERE scrape_id = ?
           ORDER BY votes DESC`
        )
        .all(snapshotId) as (VotingResults &
        WithSeats & { party: string })[]
    ).map((pv) => ({
      candidate: pv.party,
      votes: pv.votes,
      seats: pv.seats,
      electorateSeats: pv.electorateSeats,
      listSeats: pv.listSeats,
    })) as (VotingResults & WithSeats)[];

    const partyLists = (
      conn
        .prepare(
          `SELECT party, candidate, list_rank AS listRank,
                  adjusted_rank AS adjustedRank,
                  distance_from_cut AS distanceFromCut
           FROM party_lists
           WHERE scrape_id = ?
           ORDER BY party ASC, list_rank ASC`
        )
        .all(snapshotId) as (PartyList & WithAdjustedRank)[]
    ).map((pl) => ({
      ...pl,
      distanceFromCut: pl.distanceFromCut ?? 0,
    }));

    return { electorateResults, partyVote, partyLists };
  }

  function withConnection<T>(
    fn: (conn: Database.Database) => T,
    fallback: T
  ): T {
    const conn = handle();
    if (!conn) return fallback;
    return fn(conn);
  }

  return {
    snapshotMetas: (requested) =>
      withConnection((conn) => getSnapshotMetas(conn, year(requested)), []),
    electorateHistory: (name, requested) =>
      withConnection(
        (conn) => getElectorateHistory(conn, name, year(requested)),
        []
      ),
    partyVoteHistory: (requested) =>
      withConnection((conn) => getPartyVoteHistory(conn, year(requested)), []),
    latestPayload: (requested) =>
      withConnection((conn) => getLatestPayload(conn, year(requested)), null),
    isAvailable: () => handle() !== null,
    close: () => {
      if (db) db.close();
      db = null;
      openedPath = undefined;
    },
  };
}
