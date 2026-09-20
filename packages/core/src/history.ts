/**
 * History API contract shared by the collector (producer), the dashboard
 * server (proxy), and the frontend (consumer). These types describe the
 * `/history/*` REST responses served from the collector's SQLite DB.
 */

import type { ResultsPayload } from './types.js';

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

/**
 * A completed (or in-progress) election result for a nominated year, served by
 * `GET /history/results/:year`. The same payload the live pipeline publishes,
 * so a caller does not care whether a year is live or historical.
 */
export type ResultsForYear = ResultsPayload & {
  year: string;
  /** False for the live cycle, which is still counting. */
  final: boolean;
};

/**
 * A prior-cycle electorate winner, matched to the *current* cycle's electorate
 * list by name (with renames resolved — see `electorate-successions.ts`).
 *
 * Seats with no honest historical equivalent — new seats, merges and splits —
 * are absent rather than guessed at.
 */
export type PriorWinner = {
  /** Current-cycle electorate name this winner is matched to. */
  electorateName: string;
  /**
   * The name the seat carried in `year`, when it differed (a rename). The UI
   * names it so a comparison reads as "held by X (as Rimutaka)" rather than
   * silently attributing one seat's member to another.
   */
  priorElectorateName: string | null;
  year: string;
  candidate: string;
  party: string | null;
  votes: number;
  majority: number;
  /** Winning margin as a share of votes cast in the electorate. */
  majorityPercent: number;
};

export type PriorWinnersYear = {
  year: string;
  winners: PriorWinner[];
};

/**
 * `GET /history/prior-winners` — every prior cycle the collector could derive,
 * newest first, each already matched to the current cycle's electorate names.
 *
 * `primaryYear` is the cycle prior-winner comparisons should default to (the
 * immediately preceding one, unless `PRIOR_ELECTION_YEAR` overrides it), or
 * null when no prior cycle could be fetched at all — which is the signal for
 * the UI's "prior results unavailable" state.
 */
export type PriorWinnersResponse = {
  currentYear: string;
  primaryYear: string | null;
  years: PriorWinnersYear[];
};
