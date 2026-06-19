import { load, type CheerioAPI } from 'cheerio';
import {
  type ElectorateConfig,
  type ElectionSource,
  type RawElectorateResults,
  type VotingResults,
} from '../types.js';

const DEFAULT_BASE_URL = 'https://electionresults.govt.nz/electionresults_2023';

const DEFAULT_RESULTS_TABLE_SELECTOR =
  '#electorate_details_partycandidate_content';

const DEFAULT_CANDIDATE_TABLE_SELECTOR =
  '#electorate_details_partycandidate_content #candidate_votes';

const DEFAULT_PARTY_VOTE_TABLE_SELECTOR =
  '#electorate_details_partycandidate_content #party_votes';

const DEFAULT_VOTE_PERCENT_COUNTED_SELECTOR =
  '#electorate_details_table > tbody > tr:nth-child(1) > td:nth-child(3) > div';

const DEFAULT_VOTES_COUNTED_SELECTOR =
  '#electorate_details_table > tbody > tr:nth-child(1) > td:nth-child(2) > div';

export class NzElectionResultsSource implements ElectionSource {
  private baseUrl: string;
  private electorateNames: string[];
  private resultsTableSelector: string;
  private candidateTableSelector: string;
  private partyVoteTableSelector: string;
  private votePercentCountedSelector: string;
  private votesCountedSelector: string;
  private verbose: boolean;

  constructor(options: {
    baseUrl?: string;
    electorateNames: string[];
    resultsTableSelector?: string;
    candidateTableSelector?: string;
    partyVoteTableSelector?: string;
    votePercentCountedSelector?: string;
    votesCountedSelector?: string;
    verbose?: boolean;
  }) {
    this.baseUrl =
      options?.baseUrl ?? process.env.BASE_RESULTS_URL ?? DEFAULT_BASE_URL;

    this.electorateNames = options.electorateNames;

    this.resultsTableSelector =
      options?.resultsTableSelector ??
      process.env.RESULTS_TABLE_SELECTOR ??
      DEFAULT_RESULTS_TABLE_SELECTOR;

    this.candidateTableSelector =
      options?.candidateTableSelector ??
      process.env.CANDIDATE_TABLE_SELECTOR ??
      DEFAULT_CANDIDATE_TABLE_SELECTOR;

    this.partyVoteTableSelector =
      options?.partyVoteTableSelector ??
      process.env.PARTY_VOTE_TABLE_SELECTOR ??
      DEFAULT_PARTY_VOTE_TABLE_SELECTOR;

    this.votePercentCountedSelector =
      options?.votePercentCountedSelector ??
      process.env.VOTE_PERCENT_COUNTED_SELECTOR ??
      DEFAULT_VOTE_PERCENT_COUNTED_SELECTOR;

    this.votesCountedSelector =
      options?.votesCountedSelector ??
      process.env.VOTES_COUNTED_SELECTOR ??
      DEFAULT_VOTES_COUNTED_SELECTOR;

    this.verbose = options?.verbose ?? false;
  }

  getElectorateConfigs(): ElectorateConfig[] {
    return this.electorateNames.map((name, index) => ({
      electorateName: name,
      url: `${this.baseUrl}/electorate-details-${String(index + 1).padStart(2, '0')}.html`,
    }));
  }

  parseRawResults(
    html: string,
    config: ElectorateConfig
  ): RawElectorateResults {
    this.debug(`parseRawResults for ${config.electorateName}, HTML length=${html.length}`);
    this.debug(`HTML preview: ${html.slice(0, 500).replace(/\s+/g, ' ')}`);

    const $ = load(html);

    const candidateVotes = this.parseCandidateVotes($);
    const partyVotes = this.parsePartyVotes($);
    const votesCounted = this.parseVotesCounted($);
    const votePercentageCounted = this.parseVotePercentCounted($);

    this.debug(
      `parsed ${config.electorateName}: ${candidateVotes.length} candidates, ${partyVotes.length} party entries, votesCounted=${votesCounted}, pct=${votePercentageCounted}`
    );

    return {
      electorateName: config.electorateName,
      candidateVotes,
      partyVotes,
      votesCounted,
      votePercentageCounted,
    };
  }

  private debug(...args: unknown[]) {
    if (this.verbose) console.warn('[parse]', ...args);
  }

  private parseTable($: CheerioAPI, selector: string): VotingResults[] {
    const $table = $(selector);
    this.debug(`parseTable: selector="${selector}" found=${$table.length}`);
    if (!$table.length) {
      this.debug('table not found — selector may not match');
      return [];
    }

    const data: VotingResults[] = [];
    $table.find('tr').each((_index, element) => {
      const $cell = $(element).find('td').first();
      const name = $cell.find('span:first-child').text();
      const votes = parseInt($cell.find('span:last-child').text(), 10);

      if (name && !Number.isNaN(votes)) {
        data.push({ candidate: name, votes });
      } else {
        this.debug(`skipped row: name="${name}" votes=${votes}`);
      }
    });

    this.debug(`parsed ${data.length} rows from ${selector}`);
    if (data.length > 0) {
      this.debug('first row:', JSON.stringify(data[0]));
      this.debug('last row:', JSON.stringify(data[data.length - 1]));
    }
    return data;
  }

  private parseCandidateVotes($: CheerioAPI): VotingResults[] {
    const found = $(this.candidateTableSelector).length;
    this.debug(`parseCandidateVotes: selector="${this.candidateTableSelector}" found=${found} elements`);
    if (found > 0) {
      return this.parseTable($, this.candidateTableSelector);
    }
    this.debug('candidateTableSelector not found, falling back to parseColumn');
    return this.parseColumn($, 0);
  }

  private parsePartyVotes($: CheerioAPI): VotingResults[] {
    const found = $(this.partyVoteTableSelector).length;
    this.debug(`parsePartyVotes: selector="${this.partyVoteTableSelector}" found=${found} elements`);
    if (found > 0) {
      return this.parseTable($, this.partyVoteTableSelector);
    }
    this.debug('partyVoteTableSelector not found, falling back to parseColumn');
    return this.parseColumn($, 1);
  }

  /** @deprecated Use separate candidateTableSelector/partyVoteTableSelector instead */
  private parseColumn($: CheerioAPI, columnIndex: number): VotingResults[] {
    const $container = $(this.resultsTableSelector);
    this.debug(`parseColumn: column=${columnIndex}, container found=${$container.length}`);
    if (!$container.length) {
      this.debug('parseColumn: container not found');
      return [];
    }

    const data: VotingResults[] = [];
    $container.find('table tr').each((_index, element) => {
      const $cells = $(element).find('td');

      if ($cells.length === 2) {
        const candidate = $cells
          .eq(columnIndex)
          .find('span:first-child')
          .text();
        const votes = parseInt(
          $cells.eq(columnIndex).find('span:last-child').text(),
          10
        );

        if (candidate && !Number.isNaN(votes)) {
          data.push({ candidate, votes });
        }
      }
    });

    this.debug(`parseColumn: parsed ${data.length} rows`);
    return data;
  }

  private parseVotePercentCounted($: CheerioAPI): number {
    const el = $(this.votePercentCountedSelector);
    this.debug(`parseVotePercentCounted: selector="${this.votePercentCountedSelector}" found=${el.length}`);
    const text = el.text();
    if (!text) {
      this.debug('vote percent element empty or not found');
      return 0;
    }
    const value = Number.parseFloat(text.replace('%', '')) / 100;
    this.debug(`parseVotePercentCounted: raw="${text}" -> ${value}`);
    return value;
  }

  private parseVotesCounted($: CheerioAPI): number {
    const el = $(this.votesCountedSelector);
    this.debug(`parseVotesCounted: selector="${this.votesCountedSelector}" found=${el.length}`);
    const text = el.text();
    if (!text) {
      this.debug('votes counted element empty or not found');
      return 0;
    }
    const value = Number.parseFloat(text.replace(',', ''));
    this.debug(`parseVotesCounted: raw="${text}" -> ${value}`);
    return value;
  }

}
