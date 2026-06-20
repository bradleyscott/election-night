import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ResultsPayload } from '@election-night/core/types';
import { dashboardServerConfig } from './config.js';
import { log } from './logger.js';
import { openDbReader, closeDbReader } from './db-reader.js';
import {
  loadFeedEventsFromDisk,
  setFeedEvents,
  getFeedEvents,
  clearFeedEvents,
  addFeedEvents,
  buildFeedEvents,
} from './feed-engine.js';
import { createHttpRequestHandler } from './http-router.js';
import { attachSocketHandlers } from './socket-handlers.js';

const {
  wsPort: PORT,
  cachePath: CACHE_PATH,
  dbPath,
} = dashboardServerConfig;

const latestResults: { current: ResultsPayload | null } = { current: null };

function loadCachedResults() {
  if (existsSync(CACHE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
      latestResults.current = {
        electorateResults: data,
        partyVote: [],
        partyLists: [],
      };
      log.info(`Loaded cached results from ${CACHE_PATH}`);
      return;
    } catch (err) {
      log.error('Failed to load cached results', err);
    }
  }
  log.info('No cached results found, waiting for first scrape...');
}

const io = new Server({
  cors: { origin: '*' },
});

const server = createServer(
  createHttpRequestHandler({
    latestResults,
    getFeedEvents,
    io,
    clearState: () => {
      clearFeedEvents();
    },
  })
);

io.attach(server);

attachSocketHandlers(io, {
  latestResults,
  getFeedEvents,
  buildFeedEvents,
  addFeedEvents,
});

let dbPollTimer: ReturnType<typeof setInterval> | null = null;

server.listen(PORT, () => {
  log.info('=== Dashboard Server Configuration ===');
  log.info(`WS_PORT:         ${PORT}`);
  log.info(`DB_PATH:         ${resolve(dbPath)}`);
  log.info(`DIST_DIR:        ${resolve(dashboardServerConfig.distDir)}`);
  log.info(`CACHE_PATH:      ${resolve(CACHE_PATH)}`);
  log.info(`FEED_CACHE_PATH: ${resolve(dashboardServerConfig.feedCachePath)}`);
  log.info(`MAX_FEED_EVENTS: ${dashboardServerConfig.maxFeedEvents}`);
  log.info(`CWD:             ${process.cwd()}`);
  log.info('======================================');
  log.info(`Socket.io server running on http://localhost:${PORT}`);
  openDbReader(dbPath);
  loadCachedResults();
  setFeedEvents(loadFeedEventsFromDisk());
});

// Poll for the DB to appear (collector creates it on first scrape)
dbPollTimer = setInterval(() => {
  import('./db-reader.js').then(({ hasDbReader, openDbReader }) => {
    if (!hasDbReader() && existsSync(dbPath)) {
      openDbReader(dbPath);
    }
  });
}, 5000);

function shutdown(): void {
  if (dbPollTimer) {
    clearInterval(dbPollTimer);
    dbPollTimer = null;
  }
  closeDbReader();
  io.close();
  server.close();
}

process.on('SIGINT', () => {
  log.info('Shutting down...');
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Shutting down...');
  shutdown();
  process.exit(0);
});

export function stopDashboardServer(): void {
  shutdown();
}

export { server, io };
