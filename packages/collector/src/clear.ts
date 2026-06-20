import 'dotenv/config';
import { unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { log } from './logger.js';

const TABLES_IN_ORDER = [
  'party_lists',
  'party_vote_summary',
  'party_vote_results',
  'electorate_summary',
  'electorate_results',
  'scrape_snapshots',
];

const FEED_CACHE_PATH = process.env.FEED_CACHE_PATH || '.data/feed_events.json';

const CACHE_FILES = [
  resolve(process.cwd(), '.data/electorate_results.json'),
  resolve(process.cwd(), FEED_CACHE_PATH),
];

export async function runClear(): Promise<void> {
  const dbPath = process.env.DB_PATH || resolve(process.cwd(), '.data/election_results.db');

  log.info('=== Clear: starting ===');

  // ── 1. Clear database ──────────────────────────────────────────────
  if (existsSync(dbPath)) {
    log.info(`Opening database: ${dbPath}`);
    const sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');

    // Disable foreign key checks so we can truncate in any order
    sqliteDb.pragma('foreign_keys = OFF');

    const deleteAll = sqliteDb.transaction(() => {
      let totalRows = 0;
      for (const table of TABLES_IN_ORDER) {
        const info = sqliteDb.prepare(`DELETE FROM "${table}"`).run();
        totalRows += info.changes;
        log.debug(`  Cleared ${table}: ${info.changes} rows deleted`);
      }
      return totalRows;
    });

    try {
      const totalRows = deleteAll();
      log.info(`Database cleared: ${totalRows} total rows removed from ${TABLES_IN_ORDER.length} tables`);

      // Check if vacuum is needed — SQLite DELETE marks pages as free but doesn't shrink the file
      const pageCount = (
        sqliteDb.prepare('PRAGMA page_count').get() as { page_count: number }
      ).page_count;
      const freelistCount = (
        sqliteDb.prepare('PRAGMA freelist_count').get() as { freelist_count: number }
      ).freelist_count;

      if (totalRows > 0 || freelistCount > 100) {
        log.info(
          `Vacuuming database to reclaim disk space (${freelistCount} free pages of ${pageCount} total)...`
        );
        sqliteDb.exec('VACUUM;');
        const newPageCount = (
          sqliteDb.prepare('PRAGMA page_count').get() as { page_count: number }
        ).page_count;
        const pageSize = (
          sqliteDb.prepare('PRAGMA page_size').get() as { page_size: number }
        ).page_size;
        log.info(
          `Vacuum complete: ${newPageCount} pages, ${(newPageCount * pageSize) / 1024 / 1024} MB`
        );
      }
    } finally {
      sqliteDb.pragma('foreign_keys = ON');
      sqliteDb.close();
    }
  } else {
    log.info(`No database found at ${dbPath}, skipping`);
  }

  // ── 2. Clear cache files ───────────────────────────────────────────
  for (const cachePath of CACHE_FILES) {
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
      log.info(`Deleted cache file: ${cachePath}`);
    } else {
      log.debug(`No cache file at ${cachePath}, skipping`);
    }
  }

  log.info('=== Clear: completed ===');
}

// Allow running directly: npx tsx packages/collector/src/clear.ts
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  runClear().catch((err) => {
    console.error('Clear failed:', err);
    process.exit(1);
  });
}
