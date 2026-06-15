import { existsSync } from 'fs';
import Database from 'better-sqlite3';

function normalizePartyName(party: string | null | undefined): string | null | undefined {
  if (!party) return party;
  if (party === 'Māori Party') return 'Te Pāti Māori';
  return party;
}

export type CandidateSnapshot = {
  candidate: string;
  party: string | null;
  votes: number;
  isPredicted: boolean;
};

export type PartyVoteSnapshot = {
  party: string;
  votes: number;
};

export type ElectorateHistoryPoint = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
  votesCounted: number;
  votePctCounted: number;
  leadingCandidate: string | null;
  leadingParty: string | null;
  predictedWinner: number;
  margin: number | null;
  marginPct: number | null;
  marginOfError: number | null;
  candidates: CandidateSnapshot[];
  partyVotes: PartyVoteSnapshot[];
};

export type PartyVoteHistoryPoint = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
  parties: {
    party: string;
    votes: number;
    seats: number;
    electorateSeats: number;
    listSeats: number;
  }[];
};

export type SnapshotMeta = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
};

let db: Database.Database | null = null;

export function openDbReader(dbPath: string): void {
  if (!existsSync(dbPath)) {
    console.log(`DB not found at ${dbPath}, history API will return empty results`);
    return;
  }
  db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');
  console.log(`Opened history DB (read-only) at ${dbPath}`);
}

export function closeDbReader(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getSnapshotMetas(): SnapshotMeta[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id AS snapshot_id, started_at, completed_at
       FROM scrape_snapshots
       ORDER BY started_at ASC`
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    snapshotId: r.snapshot_id as number,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string) ?? null,
  }));
}

export function getElectorateHistory(name: string): ElectorateHistoryPoint[] {
  if (!db) return [];

  const summaries = db
    .prepare(
      `SELECT
         ss.id AS snapshot_id,
         ss.started_at,
         ss.completed_at,
         es.votes_counted,
         es.vote_pct_counted,
         es.leading_candidate,
         es.leading_party,
         es.predicted_winner,
         es.margin,
         es.margin_pct,
         es.margin_of_error
       FROM scrape_snapshots ss
       JOIN electorate_summary es ON es.scrape_id = ss.id
       WHERE es.electorate = ?
       ORDER BY ss.started_at ASC`
    )
    .all(name) as Record<string, unknown>[];

  const history: ElectorateHistoryPoint[] = [];

  for (const row of summaries) {
    const candidates = db
      .prepare(
        `SELECT candidate, party, votes, is_predicted
         FROM electorate_results
         WHERE scrape_id = ? AND electorate = ?
         ORDER BY votes DESC`
      )
      .all(row.snapshot_id, name) as Record<string, unknown>[];

    const partyVoteRows = db
      .prepare(
        `SELECT party, votes
         FROM party_vote_results
         WHERE scrape_id = ? AND electorate = ?
         ORDER BY votes DESC`
      )
      .all(row.snapshot_id, name) as Record<string, unknown>[];

    history.push({
      snapshotId: row.snapshot_id as number,
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string) ?? null,
      votesCounted: row.votes_counted as number,
      votePctCounted: row.vote_pct_counted as number,
      leadingCandidate: (row.leading_candidate as string) ?? null,
      leadingParty: normalizePartyName(row.leading_party as string | null) ?? null,
      predictedWinner: row.predicted_winner as number,
      margin: (row.margin as number) ?? null,
      marginPct: (row.margin_pct as number) ?? null,
      marginOfError: (row.margin_of_error as number) ?? null,
      candidates: candidates.map((c) => ({
        candidate: c.candidate as string,
        party: (c.party as string) ?? null,
        votes: c.votes as number,
        isPredicted: (c.is_predicted as number) === 1,
      })),
      partyVotes: partyVoteRows.map((p) => ({
        party: normalizePartyName(p.party as string) ?? (p.party as string),
        votes: p.votes as number,
      })),
    });
  }

  return history;
}

export function getPartyVoteHistory(): PartyVoteHistoryPoint[] {
  if (!db) return [];

  const snapshots = db
    .prepare(
      `SELECT id AS snapshot_id, started_at, completed_at
       FROM scrape_snapshots
       ORDER BY started_at ASC`
    )
    .all() as Record<string, unknown>[];

  const history: PartyVoteHistoryPoint[] = [];

  for (const snap of snapshots) {
    const sid = snap.snapshot_id as number;
    const parties = db
      .prepare(
        `SELECT party, votes, seats, electorate_seats, list_seats
         FROM party_vote_summary
         WHERE scrape_id = ?
         ORDER BY votes DESC`
      )
      .all(sid) as Record<string, unknown>[];

    history.push({
      snapshotId: sid,
      startedAt: snap.started_at as string,
      completedAt: (snap.completed_at as string) ?? null,
      parties: parties.map((p) => ({
        party: normalizePartyName(p.party as string) ?? (p.party as string),
        votes: p.votes as number,
        seats: p.seats as number,
        electorateSeats: p.electorate_seats as number,
        listSeats: p.list_seats as number,
      })),
    });
  }

  return history;
}
