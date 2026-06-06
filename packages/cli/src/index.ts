import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import pLimit from 'p-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { launch } from 'cloakbrowser/puppeteer';
import { config } from '@election-night/core/config';
import { NzElectionResultsSource } from '@election-night/core/sources/nz-election-results';
import type {
  ElectorateConfig,
  ElectorateResults,
  ElectionSource,
  PartyList,
} from '@election-night/core/types';
import {
  calculateLead,
  calculatePartyVoteWithPercentages,
  calculatePartyVoteWithSeats,
  predictWinner,
  calculatePartyList,
} from '@election-night/core/reducers';
import { getElectoratePageHtml } from './scraper.js';
import {
  cacheResults,
  hasLeaderChanged,
  hasNewPrediction,
  processLeaderChange,
  processNewPrediction,
} from './results.js';
import { log } from './logger.js';
import { openDb, closeDb, writeResults } from './db.js';
import { connectWs, publishResults, disconnectWs } from './ws-client.js';

if (process.argv[2] === 'discover') {
  const { runDiscover } = await import('./discover.js');
  await runDiscover(process.argv.slice(3));
  process.exit(0);
}

const CSV_CANDIDATES = readFileSync(
  resolve(__dirname, '../../../csv/candidates.csv'),
  'utf-8'
);
const candidateRecords = parse(CSV_CANDIDATES, { columns: true }) as Record<string, string>[];

const CSV_PARTY_LIST = readFileSync(
  resolve(__dirname, '../../../csv/party_list.csv'),
  'utf-8'
);
const partyListRecords: PartyList[] = parse(CSV_PARTY_LIST, { columns: true }).map(
  (x: Record<string, string>) => ({
    party: x.Party,
    candidate: `${x['Ballot Last Name']}, ${x['Ballot First Name']}`,
    listRank: Number(x['List No.']),
  })
);

const CSV_ELECTORATES = readFileSync(
  resolve(__dirname, '../../../csv/electorates.csv'),
  'utf-8'
)
  .trim()
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const partyMap: Record<string, string | undefined> = {};
for (const row of candidateRecords) {
  partyMap[row.Name] = row.Party;
  partyMap[normalizeName(row.Name)] = row.Party;
}

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '120000', 10);

const WS_PORT = parseInt(process.env.WS_PORT || '3456', 10);
const WS_URL = process.env.WS_URL || `ws://localhost:${WS_PORT}`;

async function loadSource(): Promise<{
  source: ElectionSource;
  configs: ElectorateConfig[];
}> {
  const sourcePath = process.env.ELECTION_SOURCE_PATH;

  if (sourcePath) {
    const resolvedPath = resolve(process.cwd(), sourcePath);
    log.info(`Loading custom election source from: ${resolvedPath}`);
    try {
      const mod = await import(resolvedPath);
      const SourceClass = mod.default ?? mod.NzElectionResultsSource;
      const source = new SourceClass() as ElectionSource;
      const configs = source.getElectorateConfigs();
      log.info(`Loaded source with ${configs.length} electorates`);
      return { source, configs };
    } catch (err) {
      log.error(
        `Failed to load source from ${resolvedPath}, falling back to default`,
        err
      );
    }
  }

  const verbose = parseInt(process.env.LOG_LEVEL ?? '', 10) < 3;
  const source = new NzElectionResultsSource({ electorateNames: CSV_ELECTORATES, verbose });
  const configs = source.getElectorateConfigs();
  return { source, configs };
}

const { source, configs: electorateConfigs } = await loadSource();

const run = async () => {
  try {
    log.info('Starting election results scraping...');

    const browser = await launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
    const limit = pLimit(CONCURRENCY);

    try {
      const settled = await Promise.allSettled(
        electorateConfigs.map((x) =>
          limit(() =>
            getElectoratePageHtml(browser, x).then((html) => ({ html, config: x }))
          )
        )
      );

      const results: ElectorateResults[] = [];
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          const raw = source.parseRawResults(s.value.html, s.value.config);
          const candidateVotes = raw.candidateVotes.map((cv) => {
            const party =
              partyMap[cv.candidate] ?? partyMap[normalizeName(cv.candidate)];
            if (!party) {
              log.debug(
                `No party match for candidate "${cv.candidate}" in ${raw.electorateName}`
              );
            }
            return { ...cv, party };
          });
          const electorateResults = {
            electorateName: raw.electorateName,
            partyVotes: raw.partyVotes,
            candidateVotes,
            votesCounted: raw.votesCounted,
            votePercentageCounted: raw.votePercentageCounted,
          };
          log.debug(
            `${electorateResults.electorateName}: ${electorateResults.candidateVotes.length} candidates, ${electorateResults.partyVotes.length} party entries, votesCounted=${electorateResults.votesCounted}, pct=${electorateResults.votePercentageCounted}`
          );
          if (electorateResults.candidateVotes.length > 0) {
            log.trace(
              `${electorateResults.electorateName} top candidate: ${electorateResults.candidateVotes[0].candidate} (${electorateResults.candidateVotes[0].votes} votes)`
            );
            if (electorateResults.partyVotes.length > 0) {
              log.trace(
                `${electorateResults.electorateName} top party: ${electorateResults.partyVotes[0].candidate} (${electorateResults.partyVotes[0].votes} votes)`
              );
            }
          }
          results.push(electorateResults);
        } else {
          log.error(`Failed to scrape electorate`, s.reason);
        }
      }

      const totalVotes = results.reduce((s, r) => s + (r.votesCounted || 0), 0);
      log.info(
        `Finished scraping ${results.length}/${electorateConfigs.length} electorates (total votes counted: ${totalVotes.toLocaleString()})`
      );
      if (results.length > 0) {
        const zeroVoteElectorates = results.filter((r) => (r.votesCounted || 0) === 0).length;
        if (zeroVoteElectorates > 0) {
          log.warn(`${zeroVoteElectorates} electorates have 0 votes counted`);
        }
      }

      const withPredictions = results
        .map((x) => calculateLead(x, partyMap))
        .map((x) => predictWinner(x, config.predictionConfidence));

      const partyVote = calculatePartyVoteWithSeats(
        calculatePartyVoteWithPercentages(
          withPredictions,
          config.predictionConfidence
        ),
        withPredictions
      );

      const partyLists = calculatePartyList(
        withPredictions,
        partyVote,
        partyListRecords
      );

      const totalSeats = partyVote.reduce((s, p) => s + p.seats, 0);
      const partiesWithSeats = partyVote.filter((p) => p.seats > 0).length;
      log.info(
        `Party votes: ${partyVote.length} parties, ${totalSeats} total seats, ${partiesWithSeats} parties in parliament`
      );
      if (partyVote.length > 0) {
        log.debug(
          `Top 3 parties: ${partyVote
            .sort((a, b) => b.seats - a.seats)
            .slice(0, 3)
            .map((p) => `${p.candidate} (${p.seats} seats)`)
            .join(', ')}`
        );
      }
      if (totalSeats === 0) {
        log.warn('Total seats is 0 — party vote calculation produced no seats');
      }

      const totalListCandidates = partyLists.filter((pl) => pl.distanceFromCut >= 0).length;
      log.debug(`${totalListCandidates} list candidates above the cut`);

      await Promise.all(
        withPredictions.filter(hasLeaderChanged).map(processLeaderChange)
      );

      await Promise.all(
        withPredictions.filter(hasNewPrediction).map(processNewPrediction)
      );

      cacheResults(withPredictions);
      writeResults(withPredictions, partyVote, partyLists);
      publishResults({
        electorateResults: withPredictions,
        partyVote,
        partyLists,
      });
    } finally {
      await browser.close().catch((err) =>
        log.error('Error closing browser', err)
      );
    }

    log.info('Processing of results completed!');
  } catch (err) {
    log.error('Election night cycle failed', err);
  }
};

const loopRun = async () => {
  await run();
  setTimeout(loopRun, POLL_INTERVAL_MS);
};

process.on('unhandledRejection', (reason) => {
  if (
    reason instanceof Error &&
    (reason.message.includes('TargetCloseError') ||
      reason.message.includes('Protocol error'))
  ) {
    return;
  }
  log.error('Unhandled rejection', reason);
});

const dbPath = process.env.DB_PATH || '.cache/election_results.db';

openDb(dbPath);
connectWs(WS_URL);
loopRun().catch((err) => log.error('Fatal error in loop', err));

process.on('SIGINT', () => {
  disconnectWs();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectWs();
  closeDb();
  process.exit(0);
});
