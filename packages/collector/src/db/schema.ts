import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const scrapeSnapshots = sqliteTable('scrape_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

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
    isPredicted: integer('is_predicted').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.scrapeId, table.electorate, table.candidate],
    }),
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
    predictedWinner: integer('predicted_winner').notNull().default(0),
    margin: integer('margin'),
    marginPct: real('margin_pct'),
    secondCandidate: text('second_candidate'),
    secondParty: text('second_party'),
    marginOfError: real('margin_of_error'),
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
