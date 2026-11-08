/**
 * Read-side SQL for the history API, grouped so the query count does not grow
 * with the number of snapshots.
 *
 * The old shape read one snapshot's children at a time: an electorate's history
 * cost `1 + 2N` statements and party-vote history `1 + 2N`, where `N` is the
 * number of snapshots in the window (up to 1,440 for a 24h window at a 60s
 * poll). That is an N+1 on the endpoint the Trends page calls, and it ran on
 * the same event loop that writes SQLite. These functions issue a fixed set:
 * one paged snapshot query plus one or two child queries for the whole page.
 *
 * Reads are bounded twice: by a trailing window (default 24h, matching
 * retention) and by an explicit page. The caller decides what to do when the
 * window holds more rows than the page — never silently truncate.
 */

import type Database from 'better-sqlite3';
import type { ResultsPayload } from '@election-night/core/types';
import type {
  CandidateSnapshot,
  ElectorateHistoryPoint,
  LatestStateRow,
  PartyVoteEntry,
  PartyVoteHistoryPoint,
  PartyVoteSnapshot,
  SnapshotMeta,
} from '@election-night/core/history';

/** Default trailing window. Matches the collector's 24h retention default. */
export const DEFAULT_HISTORY_WINDOW_HOURS = 24;

/**
 * Default hard cap on rows in one response. A 60s poll produces 1,440
 * snapshots in 24h, so this leaves headroom for a slightly shorter cadence
 * without letting one request scan an unbounded table.
 */
export const DEFAULT_HISTORY_MAX_SNAPSHOTS = 2_000;

export interface HistoryPageRequest {
  windowHours: number;
  limit: number;
  offset: number;
  /** Return only rows whose committed revision is greater than this. */
  sinceRevision?: number;
}

export interface HistoryPage<T> {
  rows: T[];
  /** Matching rows in the window, before `limit`/`offset`. */
  total: number;
}

export type { LatestStateRow };

export type SnapshotMetaRow = SnapshotMeta & {
  electionYear: string;
  /** Null for legacy rows written before revisions existed. */
  revision: number | null;
  modelVersion: number | null;
};
export type ElectorateHistoryRow = ElectorateHistoryPoint & {
  electionYear: string;
  revision: number | null;
  modelVersion: number | null;
};
export type PartyVoteHistoryRow = PartyVoteHistoryPoint & {
  electionYear: string;
  revision: number | null;
  modelVersion: number | null;
};

/**
 * Async read side of history, implemented by the SQLite worker client in
 * production and by a direct connection in tests. The handler only needs this
 * shape, so it does not know which thread owns the database.
 */
export interface HistoryReader {
  snapshots(
    electionYear: string,
    page: HistoryPageRequest
  ): Promise<HistoryPage<SnapshotMetaRow>>;
  latest(electionYear: string): Promise<LatestStateRow | null>;
  electorate(
    name: string,
    electionYear: string,
    page: HistoryPageRequest
  ): Promise<HistoryPage<ElectorateHistoryRow>>;
  partyVotes(
    electionYear: string,
    page: HistoryPageRequest
  ): Promise<HistoryPage<PartyVoteHistoryRow>>;
}

function windowModifier(windowHours: number): string {
  return `-${Math.max(1, Math.floor(windowHours))} hours`;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

function idsOf(rows: { snapshotId: number }[]): number[] {
  return rows.map((row) => row.snapshotId);
}

/**
 * Snapshot metadata for the trailing window, newest page last.
 *
 * `COUNT(*) OVER ()` yields the window's total in the same statement, so
 * reporting a page never costs a second query.
 */
export function querySnapshotMetas(
  db: Database.Database,
  electionYear: string,
  page: HistoryPageRequest
): HistoryPage<SnapshotMetaRow> {
  const rows = db
    .prepare(
      `SELECT id AS snapshotId, election_year AS electionYear,
              started_at AS startedAt, completed_at AS completedAt,
              revision, model_version AS modelVersion,
              COUNT(*) OVER () AS total
       FROM scrape_snapshots
       WHERE election_year = ? AND started_at >= datetime('now', ?)
         ${page.sinceRevision != null ? 'AND revision > ?' : ''}
       ORDER BY started_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(
      electionYear,
      windowModifier(page.windowHours),
      ...(page.sinceRevision != null ? [page.sinceRevision] : []),
      page.limit,
      page.offset
    ) as (SnapshotMetaRow & { total: number })[];

  return {
    rows: rows.map(({ total: _total, ...row }) => row),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * One electorate's count history. Three statements regardless of page size:
 * the summaries, then every candidate and party vote for the paged snapshots.
 */
export function queryElectorateHistory(
  db: Database.Database,
  name: string,
  electionYear: string,
  page: HistoryPageRequest
): HistoryPage<ElectorateHistoryRow> {
  const summaries = db
    .prepare(
      `SELECT ss.id AS snapshotId,
              ss.election_year AS electionYear,
              ss.started_at AS startedAt,
              ss.completed_at AS completedAt,
              ss.revision AS revision,
              ss.model_version AS modelVersion,
              es.votes_counted AS votesCounted,
              es.vote_pct_counted AS votePctCounted,
              es.leading_candidate AS leadingCandidate,
              es.leading_party AS leadingParty,
              es.margin AS margin,
              es.margin_pct AS marginPct,
              COUNT(*) OVER () AS total
       FROM scrape_snapshots ss
       JOIN electorate_summary es ON es.scrape_id = ss.id
       WHERE es.electorate = ? AND ss.election_year = ?
         AND ss.started_at >= datetime('now', ?)
         ${page.sinceRevision != null ? 'AND ss.revision > ?' : ''}
       ORDER BY ss.started_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(
      name,
      electionYear,
      windowModifier(page.windowHours),
      ...(page.sinceRevision != null ? [page.sinceRevision] : []),
      page.limit,
      page.offset
    ) as (Omit<ElectorateHistoryRow, 'candidates' | 'partyVotes'> & {
    total: number;
  })[];

  if (summaries.length === 0) return { rows: [], total: 0 };

  const ids = idsOf(summaries);

  const candidateRows = db
    .prepare(
      `SELECT scrape_id AS snapshotId, candidate, party, votes
       FROM electorate_results
       WHERE electorate = ? AND scrape_id IN (${placeholders(ids.length)})
       ORDER BY scrape_id ASC, votes DESC`
    )
    .all(name, ...ids) as (CandidateSnapshot & { snapshotId: number })[];

  const partyRows = db
    .prepare(
      `SELECT scrape_id AS snapshotId, party, votes
       FROM party_vote_results
       WHERE electorate = ? AND scrape_id IN (${placeholders(ids.length)})
       ORDER BY scrape_id ASC, votes DESC`
    )
    .all(name, ...ids) as (PartyVoteSnapshot & { snapshotId: number })[];

  const candidatesBySnapshot = new Map<number, CandidateSnapshot[]>();
  for (const { snapshotId, ...entry } of candidateRows) {
    const list = candidatesBySnapshot.get(snapshotId) ?? [];
    list.push(entry);
    candidatesBySnapshot.set(snapshotId, list);
  }

  const partiesBySnapshot = new Map<number, PartyVoteSnapshot[]>();
  for (const { snapshotId, ...entry } of partyRows) {
    const list = partiesBySnapshot.get(snapshotId) ?? [];
    list.push(entry);
    partiesBySnapshot.set(snapshotId, list);
  }

  return {
    rows: summaries.map(({ total: _total, ...summary }) => ({
      ...summary,
      candidates: candidatesBySnapshot.get(summary.snapshotId) ?? [],
      partyVotes: partiesBySnapshot.get(summary.snapshotId) ?? [],
    })),
    total: summaries[0]?.total ?? 0,
  };
}

/**
 * National party-vote history. Three statements regardless of page size: the
 * snapshots, every party total for the page, and the counted totals.
 */
export function queryPartyVoteHistory(
  db: Database.Database,
  electionYear: string,
  page: HistoryPageRequest
): HistoryPage<PartyVoteHistoryRow> {
  const snapshots = db
    .prepare(
      `SELECT id AS snapshotId, election_year AS electionYear,
              started_at AS startedAt, completed_at AS completedAt,
              revision, model_version AS modelVersion,
              COUNT(*) OVER () AS total
       FROM scrape_snapshots
       WHERE election_year = ? AND started_at >= datetime('now', ?)
         ${page.sinceRevision != null ? 'AND revision > ?' : ''}
       ORDER BY started_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(
      electionYear,
      windowModifier(page.windowHours),
      ...(page.sinceRevision != null ? [page.sinceRevision] : []),
      page.limit,
      page.offset
    ) as (SnapshotMetaRow & { total: number })[];

  if (snapshots.length === 0) return { rows: [], total: 0 };

  const ids = idsOf(snapshots);

  const partyRows = db
    .prepare(
      `SELECT scrape_id AS snapshotId, party, votes, seats,
              electorate_seats AS electorateSeats,
              list_seats AS listSeats
       FROM party_vote_summary
       WHERE scrape_id IN (${placeholders(ids.length)})
       ORDER BY scrape_id ASC, votes DESC`
    )
    .all(...ids) as (PartyVoteEntry & { snapshotId: number })[];

  const countedRows = db
    .prepare(
      `SELECT scrape_id AS snapshotId,
              COALESCE(SUM(votes_counted), 0) AS votesCounted,
              COALESCE(SUM(estimated_total_votes), 0) AS estimatedTotalVotes
       FROM electorate_summary
       WHERE scrape_id IN (${placeholders(ids.length)})
       GROUP BY scrape_id`
    )
    .all(...ids) as {
    snapshotId: number;
    votesCounted: number;
    estimatedTotalVotes: number;
  }[];

  const partiesBySnapshot = new Map<number, PartyVoteEntry[]>();
  for (const { snapshotId, ...entry } of partyRows) {
    const list = partiesBySnapshot.get(snapshotId) ?? [];
    list.push(entry);
    partiesBySnapshot.set(snapshotId, list);
  }

  const countedBySnapshot = new Map(
    countedRows.map((row) => [row.snapshotId, row])
  );

  return {
    rows: snapshots.map(({ total: _total, ...snapshot }) => {
      const counted = countedBySnapshot.get(snapshot.snapshotId);
      const votesCounted = counted?.votesCounted ?? 0;
      const estimatedTotalVotes = counted?.estimatedTotalVotes ?? 0;
      return {
        ...snapshot,
        votesCounted,
        votePctCounted:
          estimatedTotalVotes > 0 ? votesCounted / estimatedTotalVotes : 0,
        parties: partiesBySnapshot.get(snapshot.snapshotId) ?? [],
      };
    }),
    total: snapshots[0]?.total ?? 0,
  };
}

/** The authoritative latest payload for a cycle, or null before the first commit. */
export function queryLatestState(
  db: Database.Database,
  electionYear: string
): LatestStateRow | null {
  const row = db
    .prepare(
      `SELECT election_year AS electionYear, revision, payload, source,
              observed_at AS observedAt, phase, coverage,
              model_version AS modelVersion, config_version AS configVersion,
              updated_at AS updatedAt
       FROM latest_state WHERE election_year = ?`
    )
    .get(electionYear) as
    | (Omit<LatestStateRow, 'payload' | 'coverage'> & {
        payload: string;
        coverage: string | null;
      })
    | undefined;
  if (!row) return null;
  return {
    ...row,
    payload: JSON.parse(row.payload) as ResultsPayload,
    coverage: row.coverage ? JSON.parse(row.coverage) : null,
  };
}
