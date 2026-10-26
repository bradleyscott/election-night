import { XMLParser } from 'fast-xml-parser';
import type {
  ElectorateConfig,
  ElectionSource,
  NationalStatus,
  PartyList,
  PartyStatus,
  RawElectorateResults,
  VotingResults,
  WithParty,
} from '../types.js';

const DEFAULT_YEAR = '2023';

/**
 * The Commission publishes the cycle being counted on a bare, cycle-less media
 * feed, and files each finished cycle on the archive host under its year. The
 * old `electionresults.govt.nz/electionresults_{year}/xml/` paths stopped
 * serving XML when the results site was rebuilt for 2026, so neither the live
 * cycle nor the archives are reachable there any more.
 */
const LIVE_MEDIA_FEED_URL = 'https://media.election.net.nz/xml/';
const ARCHIVE_HOST = 'https://archive.electionresults.govt.nz';

/** First cycle served by the live media feed rather than an archive. */
const FIRST_LIVE_MEDIA_CYCLE = 2026;

export type NzElectionXmlSourceOptions = {
  /** Election year, e.g. '2020', '2023', '2026'. */
  year?: string;
  /**
   * Override the full base URL. When provided, `year` is ignored.
   * Must end with a trailing slash.
   */
  baseUrl?: string;
  /** Optional custom fetch implementation (defaults to global fetch). */
  fetch?: (url: string) => Promise<string>;
  /** Per-request HTTP timeout in milliseconds (default 30s). */
  timeoutMs?: number;
  /** Optional verbose logging. */
  verbose?: boolean;
};

type XmlCandidate = {
  c_no: string;
  candidate_name: string;
  electorate: string;
  party: string;
  list_no: string;
};

type XmlParty = {
  p_no: string;
  abbrev: string;
  short_name: string;
  party_name: string;
  registered: string;
};

type XmlElectorate = {
  e_no: string;
  electorate_name: string;
};

type XmlPartyStatus = {
  p_no: string;
  votes: string;
  percent_votes: string;
  party_seats: string;
  candidate_seats: string;
  total_seats: string;
};

/** fast-xml-parser returns a single object instead of an array for one child. */
function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value ? [value as T] : [];
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function buildBaseUrl(options: NzElectionXmlSourceOptions): string {
  if (options.baseUrl) {
    return withTrailingSlash(options.baseUrl);
  }
  const year = options.year ?? DEFAULT_YEAR;
  const numericYear = Number(year);
  if (Number.isFinite(numericYear) && numericYear >= FIRST_LIVE_MEDIA_CYCLE) {
    return LIVE_MEDIA_FEED_URL;
  }
  return `${ARCHIVE_HOST}/electionresults_${year}/xml/`;
}

/**
 * The base URL a cycle is read from: the live media feed for the cycle being
 * counted, the archive host for a finished one. Exported so per-place fetching
 * (which is not part of `ElectionSource`) resolves the same URL.
 */
export function resolveFeedBaseUrl(
  options: { year?: string; baseUrl?: string } = {}
): string {
  return buildBaseUrl(options);
}

function makeFetch(timeoutMs: number) {
  return (url: string): Promise<string> =>
    fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/xml,text/xml,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; election-night-collector/1.0)',
      },
    }).then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      return res.text();
    });
}

export class NzElectionXmlSource implements ElectionSource {
  private baseUrl: string;
  private fetchHtml: (url: string) => Promise<string>;
  private verbose: boolean;
  private parser: XMLParser;

  private candidateMap = new Map<string, XmlCandidate>();
  private partyMap = new Map<string, XmlParty>();
  private electorateMap = new Map<string, XmlElectorate>();
  private configs: ElectorateConfig[] = [];
  private partyList: PartyList[] = [];
  private loadPromise: Promise<void> | null = null;

  constructor(options: NzElectionXmlSourceOptions = {}) {
    this.baseUrl = buildBaseUrl(options);
    this.fetchHtml = options.fetch ?? makeFetch(options.timeoutMs ?? 30_000);
    this.verbose = options.verbose ?? false;
    // Keep every value as a string: numeric IDs (`party`, `electorate`,
    // `list_no`, `p_no`, `c_no`) must not be coerced to numbers or the
    // string-keyed lookups below will miss. Votes are converted explicitly.
    //
    // `htmlEntities` decodes numeric character references, which the live feed
    // uses for apostrophes (`O&#39;CONNOR, Simon`) where the 2017 and 2020
    // archives use the named form (`O&apos;CONNOR`). Without it the parser
    // leaves the reference intact and the name reaches the dashboard — table,
    // map label and chart legend — rendered literally as "O&#39;CONNOR".
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      htmlEntities: true,
    });
  }

  getName(): string {
    return `NZ Election XML Feed (${this.baseUrl})`;
  }

  async loadElectorates(): Promise<ElectorateConfig[]> {
    await this.ensureLoaded();
    return this.configs;
  }

  async loadPartyList(): Promise<PartyList[]> {
    await this.ensureLoaded();
    return this.partyList;
  }

  async loadNationalStatus(): Promise<NationalStatus> {
    // The party map comes from the memoized reference data; election.xml
    // itself is re-read every poll because seats change as counts land.
    await this.ensureLoaded();
    const parsed = await this.fetchXml('election.xml');
    return this.parseNationalStatus(parsed);
  }

  async fetchResults(config: ElectorateConfig): Promise<RawElectorateResults> {
    await this.ensureLoaded();
    const xml = await this.fetchHtml(config.url);
    return this.parseElectorateXml(xml, config.electorateName);
  }

  /**
   * Load reference data once. Memoizes the in-flight promise so concurrent
   * callers (`loadElectorates()` and `loadPartyList()` are called together by
   * the collector) don't each fetch the reference files.
   */
  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadReferenceData();
    }
    return this.loadPromise;
  }

  private async loadReferenceData(): Promise<void> {
    const [candidatesXml, partiesXml, electoratesXml] = await Promise.all([
      this.fetchXml('candidates.xml'),
      this.fetchXml('parties.xml'),
      this.fetchXml('electorates.xml'),
    ]);

    this.buildCandidateMap(candidatesXml);
    this.buildPartyMap(partiesXml);
    this.buildElectorateMap(electoratesXml);
    this.buildConfigs();
    this.buildPartyList();
  }

  private async fetchXml(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    this.debug(`Loading ${url}`);
    const xml = await this.fetchHtml(url);
    return this.parser.parse(xml);
  }

  private buildCandidateMap(parsed: unknown): void {
    const root = parsed as { candidates?: { candidate?: unknown } };
    for (const item of toArray<XmlCandidate>(root.candidates?.candidate)) {
      this.candidateMap.set(item.c_no, item);
    }
  }

  private buildPartyMap(parsed: unknown): void {
    const root = parsed as { parties?: { party?: unknown } };
    for (const item of toArray<XmlParty>(root.parties?.party)) {
      this.partyMap.set(item.p_no, item);
    }
  }

  private buildElectorateMap(parsed: unknown): void {
    const root = parsed as { electorates?: { electorate?: unknown } };
    for (const item of toArray<XmlElectorate>(root.electorates?.electorate)) {
      this.electorateMap.set(item.e_no, item);
    }
  }

  private buildConfigs(): void {
    const configs: ElectorateConfig[] = [];
    for (const [eNo, electorate] of this.electorateMap) {
      const index = Number(eNo);
      const padded = String(index).padStart(2, '0');
      configs.push({
        electorateName: electorate.electorate_name,
        url: `${this.baseUrl}e${padded}/e${padded}.xml`,
      });
    }
    // Sort by electorate number so the order is deterministic.
    configs.sort((a, b) => {
      const indexA = Number(a.url.match(/e(\d+)\/e\d+\.xml$/)?.[1] ?? 0);
      const indexB = Number(b.url.match(/e(\d+)\/e\d+\.xml$/)?.[1] ?? 0);
      return indexA - indexB;
    });
    this.configs = configs;
  }

  private buildPartyList(): void {
    const list: PartyList[] = [];
    for (const candidate of this.candidateMap.values()) {
      const rank = Number(candidate.list_no);
      if (!rank || Number.isNaN(rank)) continue;
      const party = this.partyMap.get(candidate.party);
      if (!party) continue;
      list.push({
        party: party.short_name,
        candidate: candidate.candidate_name,
        listRank: rank,
      });
    }
    list.sort((a, b) => {
      if (a.party !== b.party) return a.party.localeCompare(b.party);
      return a.listRank - b.listRank;
    });
    this.partyList = list;
  }

  /**
   * `election.xml` is the Commission's own national count: party vote and the
   * seat allocation that follows from it. Nothing downstream re-derives seats.
   */
  private parseNationalStatus(parsed: unknown): NationalStatus {
    const root = (
      parsed as {
        election?: {
          statistics?: Record<string, string>;
          partystatus?: { party?: unknown };
        };
      }
    ).election;
    if (!root) {
      throw new Error('election.xml has no <election> root');
    }

    const parties: PartyStatus[] = [];
    for (const item of toArray<XmlPartyStatus>(root.partystatus?.party)) {
      const party = this.partyMap.get(item.p_no);
      if (!party) continue;
      const numbers = {
        votes: Number(item.votes),
        listSeats: Number(item.party_seats),
        electorateSeats: Number(item.candidate_seats),
        totalSeats: Number(item.total_seats),
      };
      if (Object.values(numbers).some((n) => !Number.isFinite(n))) continue;
      parties.push({ party: party.short_name, ...numbers });
    }

    const stats = root.statistics ?? {};
    const num = (key: string): number => Number(stats[key] ?? 0) || 0;
    const updated = (parsed as { election?: { updated?: string } }).election
      ?.updated;

    return {
      parties,
      totalVotesCast: num('total_votes_cast'),
      percentVotesCast: num('percent_votes_cast'),
      totalElectoratesFinal: num('total_electorates_final'),
      percentElectoratesFinal: num('percent_electorates_final'),
      totalMinimalVotes: num('total_minimal_votes'),
      totalSpecialVotes: num('total_special_votes'),
      updated: updated ?? null,
    };
  }

  private parseElectorateXml(
    xml: string,
    electorateName: string
  ): RawElectorateResults {
    const parsed = this.parser.parse(xml) as {
      electorate?: {
        statistics?: {
          total_votes_cast?: string;
          percent_voting_places_counted?: string;
        };
        partyvotes?: { party?: unknown };
        candidatevotes?: { candidate?: unknown };
      };
    };

    const root = parsed.electorate;
    if (!root) {
      throw new Error('electorate root not found in XML');
    }

    const stats = root.statistics ?? {};
    const votesCounted = Number(stats.total_votes_cast ?? 0);
    const votePercentageCounted =
      Number(stats.percent_voting_places_counted ?? 0) / 100;

    const partyVotes = this.parsePartyVotes(root.partyvotes?.party);
    const candidateVotes = this.parseCandidateVotes(
      root.candidatevotes?.candidate
    );

    return {
      electorateName,
      partyVotes,
      candidateVotes,
      votesCounted,
      votePercentageCounted,
    };
  }

  private parsePartyVotes(input: unknown): VotingResults[] {
    const results: VotingResults[] = [];
    for (const item of toArray<{ p_no: string; votes: string }>(input)) {
      const party = this.partyMap.get(item.p_no);
      if (!party) continue;
      const votes = Number(item.votes);
      if (Number.isNaN(votes)) continue;
      results.push({
        candidate: party.short_name,
        votes,
      });
    }
    return results;
  }

  private parseCandidateVotes(input: unknown): (VotingResults & WithParty)[] {
    const results: (VotingResults & WithParty)[] = [];
    for (const item of toArray<{ c_no: string; votes: string }>(input)) {
      const candidate = this.candidateMap.get(item.c_no);
      if (!candidate) continue;
      const party = this.partyMap.get(candidate.party);
      const votes = Number(item.votes);
      if (Number.isNaN(votes)) continue;
      results.push({
        candidate: candidate.candidate_name,
        votes,
        party: party?.short_name,
      });
    }
    return results;
  }

  private debug(...args: unknown[]): void {
    if (this.verbose) console.warn('[xml-source]', ...args);
  }
}
