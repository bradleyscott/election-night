/**
 * History API contract shared by the collector (producer), the dashboard
 * server (proxy), and the frontend (consumer). These types describe the
 * `/history/*` REST responses served from the collector's SQLite DB.
 */

/** A single candidate's vote data within a history snapshot */
export type CandidateSnapshot = {
  candidate: string;
  party: string | null;
  votes: number;
  isPredicted: boolean;
};

/** A single party's vote data within a history snapshot for a specific electorate */
export type PartyVoteSnapshot = {
  party: string;
  votes: number;
};

/** One point in the electorate vote history time series */
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

/** One party's data within a history snapshot */
export type PartyVoteEntry = {
  party: string;
  votes: number;
  seats: number;
  electorateSeats: number;
  listSeats: number;
};

/** One point in the party vote history time series */
export type PartyVoteHistoryPoint = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
  votesCounted: number;
  votePctCounted: number;
  parties: PartyVoteEntry[];
};

/** Snapshot metadata */
export type SnapshotMeta = {
  snapshotId: number;
  startedAt: string;
  completedAt: string | null;
};
