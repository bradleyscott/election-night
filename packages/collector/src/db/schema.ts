import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const scrapeSnapshots = sqliteTable(
  'scrape_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /**
     * Election cycle this scrape belongs to (`ELECTION_YEAR`).
     *
     * History queries are scoped to the active cycle, so a DB (or a Fly volume)
     * that still holds 2023 rows cannot leak them into 2026 charts. Nullable
     * for rows written before cycles were tracked; the 0001 migration backfills
     * those to '2023' because that was the only feed the collector could read.
     */
    electionYear: text('election_year'),
    startedAt: text('started_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    completedAt: text('completed_at'),
  },
  (table) => ({
    /**
     * The history API reads a trailing window of one cycle ordered by time.
     * Without this the planner scans every snapshot on the volume before it can
     * apply the window, so the cost grows with the volume's age rather than
     * with the window.
     */
    electionYearStartedAt: index('idx_scrape_snapshots_year_started').on(
      table.electionYear,
      table.startedAt
    ),
  })
);

export const electorateResults = sqliteTable(
  'electorate_results',
  {
    scrapeId: integer('scrape_id')
      .notNull()
      .references(() => scrapeSnapshots.id),
    electorate: text('electorate').notNull(),
    candidate: text('candidate').notNull(),
    party: text('party').notNull(),
    votes: integer('votes').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.scrapeId, table.electorate, table.candidate],
    }),
    /**
     * The grouped history read filters one electorate across the page's
     * snapshot IDs; the primary key leads with `scrape_id`, so it cannot seek
     * on the seat first.
     */
    electorateScrape: index('idx_electorate_results_seat').on(
      table.electorate,
      table.scrapeId
    ),
  })
);

export const electorateSummary = sqliteTable(
  'electorate_summary',
  {
    scrapeId: integer('scrape_id')
      .notNull()
      .references(() => scrapeSnapshots.id),
    electorate: text('electorate').notNull(),
    votesCounted: integer('votes_counted').notNull(),
    estimatedTotalVotes: real('estimated_total_votes').notNull(),
    votePctCounted: real('vote_pct_counted').notNull(),
    leadingCandidate: text('leading_candidate'),
    leadingParty: text('leading_party'),
    margin: integer('margin'),
    marginPct: real('margin_pct'),
    secondCandidate: text('second_candidate'),
    secondParty: text('second_party'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.scrapeId, table.electorate] }),
  })
);

export const partyVoteResults = sqliteTable(
  'party_vote_results',
  {
    scrapeId: integer('scrape_id')
      .notNull()
      .references(() => scrapeSnapshots.id),
    electorate: text('electorate').notNull(),
    party: text('party').notNull(),
    votes: integer('votes').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.scrapeId, table.electorate, table.party],
    }),
    /** One seat's party votes are read by seat first, then snapshot. */
    electorateScrape: index('idx_party_vote_results_seat').on(
      table.electorate,
      table.scrapeId
    ),
  })
);

export const partyVoteSummary = sqliteTable(
  'party_vote_summary',
  {
    scrapeId: integer('scrape_id')
      .notNull()
      .references(() => scrapeSnapshots.id),
    party: text('party').notNull(),
    votes: integer('votes').notNull(),
    seats: integer('seats').notNull(),
    electorateSeats: integer('electorate_seats').notNull(),
    listSeats: integer('list_seats').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.scrapeId, table.party] }),
  })
);

export const partyLists = sqliteTable(
  'party_lists',
  {
    scrapeId: integer('scrape_id')
      .notNull()
      .references(() => scrapeSnapshots.id),
    party: text('party').notNull(),
    candidate: text('candidate').notNull(),
    listRank: integer('list_rank').notNull(),
    adjustedRank: integer('adjusted_rank').notNull(),
    distanceFromCut: real('distance_from_cut'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.scrapeId, table.party, table.candidate] }),
  })
);
