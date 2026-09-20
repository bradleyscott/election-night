/**
 * Results for any nominated election year, from the configured connector.
 *
 * The live cycle keeps flowing through the collector's scrape loop, unchanged.
 * Archived cycles are final and immutable, so they are fetched once, on
 * demand, and cached in memory for the life of the process — no database, no
 * invalidation, and therefore none of the cycle-tagging machinery the SQLite
 * history tables need. A year is only ever reported when it was actually
 * fetched: an unreachable archive or a connector that cannot serve a year
 * yields `null` (the UI's "unavailable" state) rather than another cycle's
 * results under the wrong label.
 *
 * Fetching a whole cycle is ~70 small XML files. Measured against the
 * Commission's archive: ~1.6s at concurrency 10, so paying it lazily on the
 * first request that needs that year is cheaper than fetching every year at
 * startup for pages nobody may open.
 */

import type {
  ElectorateConfig,
  ElectorateResults,
  ElectionSource,
  RawElectorateResults,
  ResultsPayload,
} from './types.js';
import type {
  PriorWinner,
  PriorWinnersResponse,
  PriorWinnersYear,
  ResultsForYear,
} from './history.js';
import { buildResultsPayload } from './reducers.js';
import { NzElectionXmlSource } from './sources/nz-election-xml.js';
import { normalizeElectorateName } from './electorate-names.js';
import { resolvePriorElectorateName } from './electorate-successions.js';

/** The first MMP election; New Zealand has voted every three years since. */
const FIRST_MMP_ELECTION = 1996;

export type SourceFactory = (year: string) => ElectionSource | null;

export type ElectionResultsServiceOptions = {
  /** The cycle being counted now (`ELECTION_YEAR`). */
  currentYear: string;
  /**
   * Build a connector for a nominated year. Return `null` when this deployment
   * cannot serve that year — a mock feed that replays a single cycle, say. The
   * year is then reported unavailable instead of being answered with whatever
   * cycle the connector happens to hold.
   */
  createSource?: SourceFactory;
  /**
   * Years to probe, newest first. Defaults to every three-year cycle before
   * `currentYear` back to 1996; the walk stops at the first year that cannot
   * be fetched, so a gap in the archive does not silently skip past it.
   */
  priorYears?: string[];
  /**
   * Cycle prior-winner comparisons should default to (`PRIOR_ELECTION_YEAR`).
   * Falls back to the newest year that resolved.
   */
  preferredPriorYear?: string;
  /** Parallel electorate fetches per cycle (default 10). */
  concurrency?: number;
  /** Average delay between electorate fetches, jittered 0.5x–1.5x. */
  fetchPacingMs?: number;
  /**
   * How long to leave a failed cycle alone before trying again (default 5
   * minutes). Without a floor, every page load would re-hammer an archive that
   * has already said no — the 2014-and-earlier feeds 404, and a 6-hour night
   * would turn that into thousands of pointless requests.
   */
  unavailableRetryMs?: number;
  onLog?: (level: 'info' | 'warn', message: string, error?: unknown) => void;
};

/** A prior cycle's winner, named in that cycle's own terms. */
type CycleWinner = {
  electorateName: string;
  candidate: string;
  party: string | null;
  votes: number;
  majority: number;
  majorityPercent: number;
};

export function defaultPriorYears(currentYear: string): string[] {
  const year = Number(currentYear);
  if (!Number.isFinite(year)) return [];
  const years: string[] = [];
  for (let y = year - 3; y >= FIRST_MMP_ELECTION; y -= 3) {
    years.push(String(y));
  }
  return years;
}

function toElectorateResults(raw: RawElectorateResults): ElectorateResults {
  return {
    electorateName: raw.electorateName,
    partyVotes: raw.partyVotes,
    candidateVotes: raw.candidateVotes,
    votesCounted: raw.votesCounted,
    votePercentageCounted: raw.votePercentageCounted,
  };
}

const DEFAULT_UNAVAILABLE_RETRY_MS = 5 * 60_000;

const sleep = (ms: number) =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

/**
 * Run `fn` over `items` with a fixed number of workers. Rejects on the first
 * failure — a partially fetched cycle is not a year we are willing to call
 * final, so the caller retries the whole year later instead.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export class ElectionResultsService {
  private readonly currentYear: string;
  private readonly createSource: SourceFactory;
  private readonly priorYears: string[];
  private readonly preferredPriorYear: string | undefined;
  private readonly concurrency: number;
  private readonly fetchPacingMs: number;
  private readonly unavailableRetryMs: number;
  private readonly onLog: (
    level: 'info' | 'warn',
    message: string,
    error?: unknown
  ) => void;

  private liveResults: ResultsPayload | null = null;
  private currentElectorates: string[] = [];

  /** Fetched historical cycles. Immutable once present. */
  private readonly cache = new Map<string, ResultsPayload>();
  /** Single-flight: concurrent callers for one year share one fetch. */
  private readonly inflight = new Map<string, Promise<ResultsPayload | null>>();
  /** Years reported unavailable, so the reason is logged once, not per request. */
  private readonly reported = new Set<string>();
  /** Earliest time to try a failed cycle again. */
  private readonly retryAfter = new Map<string, number>();

  constructor(options: ElectionResultsServiceOptions) {
    this.currentYear = options.currentYear;
    this.createSource =
      options.createSource ?? ((year) => new NzElectionXmlSource({ year }));
    this.priorYears =
      options.priorYears ?? defaultPriorYears(options.currentYear);
    this.preferredPriorYear = options.preferredPriorYear;
    this.concurrency = options.concurrency ?? 10;
    this.fetchPacingMs = options.fetchPacingMs ?? 300;
    this.unavailableRetryMs =
      options.unavailableRetryMs ?? DEFAULT_UNAVAILABLE_RETRY_MS;
    this.onLog =
      options.onLog ??
      ((level, message, error) => {
        if (level === 'warn')
          console.warn(`[results-service] ${message}`, error ?? '');
        else console.info(`[results-service] ${message}`);
      });
  }

  /** The live cycle's latest payload, registered by the scrape loop. */
  setLiveResults(payload: ResultsPayload): void {
    this.liveResults = payload;
    this.setCurrentElectorates(
      payload.electorateResults.map((r) => r.electorateName)
    );
  }

  /** Electorate names of the cycle being counted, used to match prior seats. */
  setCurrentElectorates(names: string[]): void {
    this.currentElectorates = names;
  }

  /** Years this service will probe, newest first. */
  getPriorYears(): string[] {
    return [...this.priorYears];
  }

  /**
   * Results for a nominated year — the live cycle's latest scrape, or a cached
   * (or freshly fetched) archive. `null` when that year cannot be served.
   */
  async getResults(year: string): Promise<ResultsForYear | null> {
    if (year === this.currentYear) {
      return this.liveResults
        ? { year, final: false, ...this.liveResults }
        : null;
    }
    const payload = await this.getHistoricalPayload(year);
    return payload ? { year, final: true, ...payload } : null;
  }

  /**
   * Winners of every prior cycle this deployment can derive, each matched to
   * the current cycle's electorate names.
   */
  async getPriorWinners(): Promise<PriorWinnersResponse> {
    const years: PriorWinnersYear[] = [];
    for (const year of this.priorYears) {
      const payload = await this.getHistoricalPayload(year);
      if (!payload) break;
      years.push({
        year,
        winners: this.matchToCurrentCycle(year, this.cycleWinners(payload)),
      });
    }

    const preferred = this.preferredPriorYear;
    const primaryYear =
      preferred && years.some((y) => y.year === preferred)
        ? preferred
        : (years[0]?.year ?? null);

    return { currentYear: this.currentYear, primaryYear, years };
  }

  /**
   * Retry any cycle that failed earlier. Called after each scrape so a blip at
   * startup does not leave prior results unavailable until the next deploy;
   * already-cached years return immediately.
   */
  async warmPriorYears(): Promise<void> {
    await this.getPriorWinners();
  }

  private getHistoricalPayload(year: string): Promise<ResultsPayload | null> {
    const cached = this.cache.get(year);
    if (cached) return Promise.resolve(cached);

    const retryAt = this.retryAfter.get(year);
    if (retryAt !== undefined) {
      if (retryAt > Date.now()) return Promise.resolve(null);
      this.retryAfter.delete(year);
    }

    const existing = this.inflight.get(year);
    if (existing) return existing;

    const promise = this.loadYear(year).finally(() => {
      this.inflight.delete(year);
    });
    this.inflight.set(year, promise);
    return promise;
  }

  private async loadYear(year: string): Promise<ResultsPayload | null> {
    const source = this.createSource(year);
    if (!source) {
      this.reportOnce(
        year,
        'warn',
        `${year} election results are not available from this deployment's connector`
      );
      return null;
    }

    const startedAt = performance.now();
    this.onLog(
      'info',
      `Fetching ${year} election results from ${source.getName()}`
    );
    try {
      const [configs, partyList] = await Promise.all([
        source.loadElectorates(),
        source.loadPartyList(),
      ]);

      const raw = await mapWithConcurrency(
        configs,
        this.concurrency,
        async (config: ElectorateConfig) => {
          // Gentle jittered pacing, as the live scrape loop does, so a
          // historical fetch is no ruder to the archive than tonight's poll.
          await sleep(this.fetchPacingMs * (0.5 + Math.random()));
          return source.fetchResults(config);
        }
      );

      const payload = buildResultsPayload(
        raw.map(toElectorateResults),
        partyList
      );
      this.cache.set(year, payload);
      this.onLog(
        'info',
        `Cached ${year} election results (${configs.length} electorates, ${((performance.now() - startedAt) / 1000).toFixed(1)}s)`
      );
      return payload;
    } catch (err) {
      this.retryAfter.set(year, Date.now() + this.unavailableRetryMs);
      this.reportOnce(
        year,
        'warn',
        `Could not fetch ${year} election results; prior results for that cycle are unavailable for now`,
        err
      );
      return null;
    }
  }

  private cycleWinners(payload: ResultsPayload): CycleWinner[] {
    return payload.electorateResults.map((r) => ({
      electorateName: r.electorateName,
      candidate: r.leaders.leadingCandidate,
      party: r.leaders.leadingCandidateParty ?? null,
      votes: r.candidateVotes[0]?.votes ?? 0,
      majority: r.leaders.margin,
      majorityPercent: r.leaders.marginPercent,
    }));
  }

  /**
   * Attach each prior-cycle winner to the name that seat carries today,
   * resolving renames. Seats with no equivalent — new, merged or split — are
   * left out.
   */
  private matchToCurrentCycle(
    year: string,
    winners: CycleWinner[]
  ): PriorWinner[] {
    const currentByKey = new Map(
      this.currentElectorates.map((name) => [
        normalizeElectorateName(name),
        name,
      ])
    );
    if (!currentByKey.size) return [];

    const matched: PriorWinner[] = [];
    const taken = new Set<string>();

    for (const winner of winners) {
      const resolved = resolvePriorElectorateName(
        year,
        this.currentYear,
        winner.electorateName
      );
      const currentName = currentByKey.get(normalizeElectorateName(resolved));
      if (!currentName || taken.has(currentName)) continue;
      taken.add(currentName);

      const renamed =
        normalizeElectorateName(winner.electorateName) !==
        normalizeElectorateName(currentName);

      matched.push({
        electorateName: currentName,
        priorElectorateName: renamed ? winner.electorateName : null,
        year,
        candidate: winner.candidate,
        party: winner.party,
        votes: winner.votes,
        majority: winner.majority,
        majorityPercent: winner.majorityPercent,
      });
    }

    return matched;
  }

  private reportOnce(
    year: string,
    level: 'info' | 'warn',
    message: string,
    error?: unknown
  ): void {
    if (this.reported.has(year)) return;
    this.reported.add(year);
    this.onLog(level, message, error);
  }
}
