import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql, eq } from 'drizzle-orm';
import * as schema from './db/schema.js';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  VotingResults,
  WithSeats,
  PartyList,
  WithAdjustedRank,
} from '@election-night/core/types';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Results = ElectorateResults & WithLeaders & WithMarginOfError;
type PartyVoteSummary = VotingResults & WithSeats;
type PartyListEntry = PartyList & WithAdjustedRank;

let sqliteDb: Database.Database;
let drizzleDb: ReturnType<typeof drizzle<typeof schema>>;

export function openDb(dbPath: string): void {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  sqliteDb = new Database(dbPath);
  if (dbPath !== ':memory:') {
    sqliteDb.pragma('journal_mode = WAL');
  }
  drizzleDb = drizzle(sqliteDb, { schema });
  migrate(drizzleDb, {
    migrationsFolder: resolve(__dirname, '../drizzle'),
  });
}

export function closeDb() {
  if (sqliteDb) sqliteDb.close();
}

export function writeResults(
  results: Results[],
  partyVote: PartyVoteSummary[],
  partyLists: PartyListEntry[]
) {
  log.info('Writing results to DB...');

  drizzleDb.transaction((tx) => {
    const { id: scrapeId } = tx
      .insert(schema.scrapeSnapshots)
      .values({})
      .returning({ id: schema.scrapeSnapshots.id })
      .get();

    for (const r of results) {
      for (const cv of r.candidateVotes) {
        tx.insert(schema.electorateResults)
          .values({
            scrapeId,
            electorate: r.electorateName,
            candidate: cv.candidate,
            party: cv.party ?? '',
            votes: cv.votes,
            isPredicted:
              r.leaders.predictionStatus === 'projected' &&
              r.leaders.leadingCandidate === cv.candidate
                ? 1
                : 0,
          })
          .run();
      }

      tx.insert(schema.electorateSummary)
        .values({
          scrapeId,
          electorate: r.electorateName,
          votesCounted: r.votesCounted,
          estimatedTotalVotes:
            r.votePercentageCounted > 0 &&
            Number.isFinite(r.votePercentageCounted)
              ? r.votesCounted / r.votePercentageCounted
              : 0,
          votePctCounted: r.votePercentageCounted,
          leadingCandidate: r.leaders.leadingCandidate,
          leadingParty: r.leaders.leadingCandidateParty,
          predictedWinner:
            r.leaders.predictionStatus === 'projected' ? 3
            : r.leaders.predictionStatus === 'likely' ? 2
            : r.leaders.predictionStatus === 'leaning' ? 1
            : 0,
          margin: r.leaders.margin,
          marginPct: r.leaders.marginPercent,
          secondCandidate: r.leaders.secondCandidate,
          secondParty: r.leaders.secondCandidateParty,
          marginOfError: Number.isFinite(r.marginOfError)
            ? r.marginOfError
            : null,
        })
        .run();

      const seenPartyVotes = new Set<string>();
      for (const pv of r.partyVotes) {
        const key = `${r.electorateName}:${pv.candidate}`;
        if (seenPartyVotes.has(key)) continue;
        seenPartyVotes.add(key);
        tx.insert(schema.partyVoteResults)
          .values({
            scrapeId,
            electorate: r.electorateName,
            party: pv.candidate,
            votes: pv.votes,
          })
          .run();
      }
    }

    for (const pv of partyVote) {
      tx.insert(schema.partyVoteSummary)
        .values({
          scrapeId,
          party: pv.candidate,
          votes: pv.votes,
          seats: pv.seats,
          electorateSeats: pv.electorateSeats,
          listSeats: pv.listSeats,
        })
        .run();
    }

    for (const pl of partyLists) {
      tx.insert(schema.partyLists)
        .values({
          scrapeId,
          party: pl.party,
          candidate: pl.candidate,
          listRank: pl.listRank,
          adjustedRank: pl.adjustedRank,
          distanceFromCut: pl.distanceFromCut,
        })
        .run();
    }

    tx.update(schema.scrapeSnapshots)
      .set({ completedAt: sql`(datetime('now'))` })
      .where(eq(schema.scrapeSnapshots.id, scrapeId))
      .run();

    log.info(`DB write complete (scrape #${scrapeId})`);
  });
}
