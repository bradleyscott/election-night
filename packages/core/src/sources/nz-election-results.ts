import { load } from 'cheerio';
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

  constructor(options: {
    baseUrl?: string;
    electorateNames: string[];
    resultsTableSelector?: string;
    candidateTableSelector?: string;
    partyVoteTableSelector?: string;
    votePercentCountedSelector?: string;
    votesCountedSelector?: string;
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
    return {
      electorateName: config.electorateName,
      candidateVotes: this.parseCandidateVotes(html),
      partyVotes: this.parsePartyVotes(html),
      votesCounted: this.parseVotesCounted(html),
      votePercentageCounted: this.parseVotePercentCounted(html),
    };
  }

  private parseTable(selector: string, html: string): VotingResults[] {
    const tableHtml = load(html)(selector).html() ?? '';
    const $ = load(tableHtml);

    const data: VotingResults[] = [];
    $('tr').each((_index, element) => {
      const $cell = $(element).find('td').first();
      const name = $cell.find('span:first-child').text();
      const votes = parseInt($cell.find('span:last-child').text(), 10);

      if (name && !Number.isNaN(votes)) {
        data.push({ candidate: name, votes });
      }
    });

    return data;
  }

  private parseCandidateVotes(html: string): VotingResults[] {
    const $ = load(html);
    if ($(this.candidateTableSelector).length > 0) {
      return this.parseTable(this.candidateTableSelector, html);
    }
    return this.parseColumn(html, 0);
  }

  private parsePartyVotes(html: string): VotingResults[] {
    const $ = load(html);
    if ($(this.partyVoteTableSelector).length > 0) {
      return this.parseTable(this.partyVoteTableSelector, html);
    }
    return this.parseColumn(html, 1);
  }

  /** @deprecated Use separate candidateTableSelector/partyVoteTableSelector instead */
  private parseColumn(html: string, columnIndex: number): VotingResults[] {
    const resultsTableHtml = load(html)(this.resultsTableSelector).html() ?? '';
    const $ = load(resultsTableHtml);

    const data: VotingResults[] = [];
    $('table tr').each((_index, element) => {
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

    return data;
  }

  private parseVotePercentCounted(html: string): number {
    const element = load(html)(this.votePercentCountedSelector).text();
    return Number.parseFloat(element.replace('%', '')) / 100;
  }

  private parseVotesCounted(html: string): number {
    const element = load(html)(this.votesCountedSelector).text();
    return Number.parseFloat(element.replace(',', ''));
  }

}
