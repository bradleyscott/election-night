import { load } from 'cheerio';
import { Browser } from 'puppeteer';
import { ResultPageConfig, VotingResults, WithParty } from './types.js';
import { resolvePartyAffiliation } from './reducers.js';
import { config } from './config.js';
import { log } from './logger.js';

export const getCandidateResults = (
  html: string
): (VotingResults & WithParty)[] =>
  parseResults(html, 0).map((x) => ({
    ...x,
    party: resolvePartyAffiliation(x.candidate),
  }));

export const getPartyResults = (html: string): VotingResults[] =>
  parseResults(html, 1);

function parseResults(html: string, columnIndex: number): VotingResults[] {
  const resultsTableHtml = load(html)(
    config.parser.resultsTableSelector
  ).html();
  const $ = load(resultsTableHtml);

  const data: VotingResults[] = [];
  $('table tr').each((_index, element) => {
    const $cells = $(element).find('td');

    if ($cells.length === 2) {
      const candidate = $cells.eq(columnIndex).find('span:first-child').text();
      const votes = parseInt(
        $cells.eq(columnIndex).find('span:last-child').text(),
        10
      );

      if (candidate && !Number.isNaN(votes)) {
        data.push({ candidate, votes });
      }
    }
  });

  return data;
}

export async function getElectoratePageHtml(
  browser: Browser,
  config: ResultPageConfig
): Promise<string> {
  log.debug(`Fetching ${config.electorateName} results`);
  const page = await browser.newPage();
  await page.goto(config.url);
  await page.waitForNetworkIdle();
  log.debug(`${config.electorateName} results successfully fetched`);
  return page.content();
}

export function getElectorateVotePercentCounted(html: string): number {
  const element = load(html)(config.parser.votePercentCountedSelector).text();
  return Number.parseFloat(element.replace('%', '')) / 100;
}

export function getElectorateVoteCounted(html: string): number {
  const element = load(html)(config.parser.votesCountedSelector).text();
  return Number.parseFloat(element.replace(',', ''));
}

export function getElectorateResults(html: string, config: ResultPageConfig) {
  const { electorateName } = config;

  return {
    electorateName,
    partyVotes: getPartyResults(html),
    candidateVotes: getCandidateResults(html),
    votesCounted: getElectorateVoteCounted(html),
    votePercentageCounted: getElectorateVotePercentCounted(html),
  };
}
