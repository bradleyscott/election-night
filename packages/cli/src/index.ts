import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
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

const partyMap: Record<string, string | undefined> = {};
for (const row of candidateRecords) {
  partyMap[row.Name] = row.Party;
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

  const source = new NzElectionResultsSource({ electorateNames: CSV_ELECTORATES });
  const configs = source.getElectorateConfigs();
  return { source, configs };
}

const { source, configs: electorateConfigs } = await loadSource();

const run = async () => {
  try {
    log.info('Starting election results scraping...');

    puppeteer.use(StealthPlugin());
    const browser = await puppeteer.launch({ headless: true });

    const settled = await Promise.allSettled(
      electorateConfigs.map((x) =>
        getElectoratePageHtml(browser, x).then((html) => ({ html, config: x }))
      )
    );

    const results: ElectorateResults[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        const raw = source.parseRawResults(s.value.html, s.value.config);
        results.push({
          electorateName: raw.electorateName,
          partyVotes: raw.partyVotes,
          candidateVotes: raw.candidateVotes.map((cv) => ({
            ...cv,
            party: candidateRecords.find((r) => r.Name === cv.candidate)?.Party,
          })),
          votesCounted: raw.votesCounted,
          votePercentageCounted: raw.votePercentageCounted,
        });
      } else {
        log.error(`Failed to scrape electorate`, s.reason);
      }
    }

    browser.close();

    log.info(
      `Finished scraping ${results.length}/${electorateConfigs.length} electorates`
    );

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

    const partyLists = calculatePartyList(withPredictions, partyVote, partyListRecords);

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

    log.info('Processing of results completed!');
  } catch (err) {
    log.error('Election night cycle failed', err);
  }
};

const loopRun = () => {
  run();
  setTimeout(loopRun, POLL_INTERVAL_MS);
};

const dbPath = process.env.DB_PATH || '.cache/election_results.db';

openDb(dbPath);
connectWs(WS_URL);
loopRun();

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
