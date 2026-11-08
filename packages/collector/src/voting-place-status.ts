/**
 * Voting-place count status for one electorate, fetched from the feed on
 * demand.
 *
 * Why on demand rather than on every poll: the register is 632 KB and a seat's
 * place results are ~70 more files, so answering for every electorate each
 * cycle would add thousands of requests to a loop that already fetches 82
 * files — including while nothing is being counted. The dashboard asks for
 * exactly the seat a visitor opened, and the answer is reused for half a
 * minute, so the cost is proportional to what is being looked at.
 *
 * Why the result bodies and not just the directory listing: every place file
 * exists, zeroed, from the day the feed is published, and the listing's
 * timestamp is the publish time. `time_received` inside the file is the only
 * signal that a count has actually landed.
 *
 * Only the cycle being counted can be answered. The archives serve place
 * results but refuse to list the directory, so there is no way to learn which
 * places were due for a seat — an archived seat reports `available: false`
 * rather than an empty map that reads as "nothing counted".
 */

import { mapWithConcurrency } from '@election-night/core/concurrency';
import { normalizeElectorateName } from '@election-night/core/electorate-names';
import { toArray, xmlParser } from '@election-night/core/xml';
import {
  parseVotingPlaceListing,
  parseVotingPlaceRegistry,
  parseVotingPlaceResult,
  type VotingPlace,
  type VotingPlaceGroup,
  type VotingPlaceStatus,
  type VotingPlacesResponse,
} from '@election-night/core/voting-places';

export type FetchTextResult = {
  status: number;
  body: string;
};

export type VotingPlaceStatusOptions = {
  /** Feed base URL, with a trailing slash. */
  baseUrl: string;
  /** Cycle being served (`ELECTION_YEAR`). */
  electionYear: string;
  /** Fetches a URL and returns its status and body; defaults to global fetch. */
  fetchText?: (url: string) => Promise<FetchTextResult>;
  /** Place result files fetched in parallel per seat (default 6). */
  concurrency?: number;
  /** Place result files fetched in parallel service-wide (default 12). */
  maxActiveFetches?: number;
  /**
   * How many place-file fetches may wait for a slot service-wide (default 64).
   * Overflow or a wait longer than `queueWaitMs` makes the seat explicitly
   * unavailable rather than reporting every place as outstanding.
   */
  maxQueuedFetches?: number;
  /** Longest a place-file fetch may wait for a slot (default 10s). */
  queueWaitMs?: number;
  /** Per-seat cache lifetime (default 30s). */
  cacheTtlMs?: number;
  /** Register/electorate list cache lifetime (default 6h). */
  referenceTtlMs?: number;
  timeoutMs?: number;
  /** Cache clock, injectable for tests. */
  now?: () => number;
  onLog?: (message: string, error?: unknown) => void;
};

type References = {
  /** Electorate number → electorate name. */
  nameByNumber: Map<number, string>;
  /** Normalised electorate name → electorate number. */
  numberByName: Map<string, number>;
  /** `vp_id` → register entry. */
  placeById: Map<number, VotingPlace>;
};

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MAX_ACTIVE_FETCHES = 12;
/**
 * 64 waiting slots. Each seat holds at most `concurrency` (6) fetches at a
 * time, so this admits roughly ten seats opening at once behind the 12 already
 * running. A larger queue would not make the feed faster; it would only defer
 * the same limit while holding more requests open on a machine that also has to
 * scrape.
 */
const DEFAULT_MAX_QUEUED_FETCHES = 64;
const DEFAULT_QUEUE_WAIT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_REFERENCE_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Thrown when the service-wide place-fetch budget cannot admit a request.
 * Distinct from a network failure: it says "this seat cannot be answered right
 * now", so the caller must report unavailability, not an all-outstanding seat.
 */
export class FetchBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBudgetExceededError';
  }
}

type QueuedWaiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * A service-wide semaphore for place-file fetches.
 *
 * Per-seat single-flight stops ten visitors opening the same seat from fanning
 * out, but not ten visitors opening ten different seats: each would still run
 * its own pool of six. This caps the whole service, and bounds the waiting
 * queue so a burst fails explicitly instead of holding hundreds of requests.
 */
class FetchBudget {
  private active = 0;
  private readonly waiting: QueuedWaiter[] = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number,
    private readonly waitMs: number
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }

  private acquire(): Promise<() => void> {
    if (this.active < this.maxActive) {
      this.active += 1;
      return Promise.resolve(this.releaseOnce);
    }

    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(
        new FetchBudgetExceededError(
          `place fetch queue is full (${this.maxQueued} waiting)`
        )
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: QueuedWaiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          resolve(this.releaseOnce);
        },
        reject,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(
            new FetchBudgetExceededError(
              `place fetch waited longer than ${this.waitMs}ms`
            )
          );
        }, this.waitMs),
      };
      // Tests should not be kept alive by a pending queue timer.
      waiter.timer.unref?.();
      this.waiting.push(waiter);
    });
  }

  private readonly releaseOnce = (): void => {
    const next = this.waiting.shift();
    if (next) {
      // Hand the slot straight to the next waiter without dropping to zero.
      next.resolve();
      return;
    }
    this.active -= 1;
  };
}

function padElectorateNo(no: number): string {
  return String(no).padStart(2, '0');
}

function makeFetchText(timeoutMs: number) {
  return async (url: string): Promise<FetchTextResult> => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/xml,text/html,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; election-night-collector/1.0)',
      },
    });
    return { status: res.status, body: await res.text() };
  };
}

export class VotingPlaceStatusService {
  private readonly baseUrl: string;
  private readonly electionYear: string;
  private readonly fetchText: (url: string) => Promise<FetchTextResult>;
  private readonly concurrency: number;
  private readonly budget: FetchBudget;
  private readonly cacheTtlMs: number;
  private readonly referenceTtlMs: number;
  private readonly now: () => number;
  private readonly onLog: (message: string, error?: unknown) => void;

  private references: References | null = null;
  private referencesExpireAt = 0;
  private referencesPromise: Promise<References | null> | null = null;

  private readonly cache = new Map<
    string,
    { expiresAt: number; value: VotingPlacesResponse }
  >();
  private readonly inflight = new Map<string, Promise<VotingPlacesResponse>>();
  /**
   * `file` → `vp_id`, learned from the place result bodies. The listing gives
   * the file name and the body gives the register key, so a body that fails to
   * load for one poll would otherwise lose the place's identity (and its
   * marker would jump). Cheap: one entry per place file per seat.
   */
  private readonly idByFile = new Map<string, number>();

  constructor(options: VotingPlaceStatusOptions) {
    this.baseUrl = options.baseUrl.endsWith('/')
      ? options.baseUrl
      : `${options.baseUrl}/`;
    this.electionYear = options.electionYear;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.budget = new FetchBudget(
      options.maxActiveFetches ?? DEFAULT_MAX_ACTIVE_FETCHES,
      options.maxQueuedFetches ?? DEFAULT_MAX_QUEUED_FETCHES,
      options.queueWaitMs ?? DEFAULT_QUEUE_WAIT_MS
    );
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.referenceTtlMs = options.referenceTtlMs ?? DEFAULT_REFERENCE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.onLog = options.onLog ?? (() => {});
    this.fetchText =
      options.fetchText ??
      makeFetchText(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /**
   * Places that count towards `electorateName`, with their count state.
   *
   * Returns null only when the register electorates do not name this seat —
   * a boundary mismatch between the dashboard and the feed, not an outage.
   * A seat whose listing could not be read returns `available: false`.
   */
  async placesFor(
    electorateName: string
  ): Promise<VotingPlacesResponse | null> {
    const references = await this.ensureReferences();
    if (!references) return null;

    const electorateNo = references.numberByName.get(
      normalizeElectorateName(electorateName)
    );
    if (electorateNo === undefined) return null;

    const key = String(electorateNo);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    // Single-flight: a burst of visitors opening the same seat must not fan
    // out into one listing fetch and 70 place fetches each.
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const run = this.loadPlaces(electorateName, electorateNo, references)
      .then((value) => {
        if (value.available) {
          this.cache.set(key, {
            expiresAt: this.now() + this.cacheTtlMs,
            value,
          });
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, run);
    return run;
  }

  /** Drop cached answers, e.g. when the cycle advances. */
  clearCache(): void {
    this.cache.clear();
    this.idByFile.clear();
  }

  private async loadPlaces(
    electorateName: string,
    electorateNo: number,
    references: References
  ): Promise<VotingPlacesResponse> {
    const dir = `${this.baseUrl}e${padElectorateNo(electorateNo)}/votingplaces/`;
    const base = {
      electorateName,
      year: this.electionYear,
      counted: 0,
      total: 0,
      places: [] as VotingPlaceStatus[],
    };

    let listing: FetchTextResult;
    try {
      listing = await this.fetchText(dir);
    } catch (err) {
      this.onLog(`Voting place listing unreachable for ${electorateName}`, err);
      return { ...base, available: false, reason: 'unreachable' };
    }

    // The archive host serves the place result files but answers the
    // directory with 403 — there is no directory index to read.
    if (listing.status === 403 || listing.status === 404) {
      return { ...base, available: false, reason: 'not-live' };
    }
    if (listing.status !== 200) {
      this.onLog(
        `Voting place listing for ${electorateName} responded ${listing.status}`
      );
      return { ...base, available: false, reason: 'unreachable' };
    }

    const entries = parseVotingPlaceListing(listing.body);
    if (entries.length === 0) {
      // A readable directory with nothing in it is a legitimate "no places
      // published yet", not a failure.
      return { ...base, available: true, reason: null };
    }

    const counts = await this.fetchPlaceCounts(electorateName, dir, entries);
    if (counts === null) {
      return { ...base, available: false, reason: 'busy' };
    }

    const places: VotingPlaceStatus[] = entries.map((entry, index) => {
      const count = counts[index];
      const fileKey = `${electorateNo}:${entry.file}`;
      if (count) this.idByFile.set(fileKey, count.id);
      const placeId = count?.id ?? this.idByFile.get(fileKey) ?? null;
      const place =
        placeId !== null ? references.placeById.get(placeId) : undefined;
      const hasCoordinates = place?.lat != null && place?.lon != null;
      // A place that stands in this electorate is a booth; one that stands
      // anywhere else is 'elsewhere' — which is an advance voting place for a
      // general seat and almost every place for a Māori one, because no place
      // is registered against a Māori electorate. Both facts come from where
      // the place stands; neither is a claim about when the vote was cast.
      const group: VotingPlaceGroup = hasCoordinates
        ? entry.electorateNo === electorateNo
          ? 'seat'
          : 'elsewhere'
        : 'mobile';

      return {
        id: placeId,
        name:
          place?.name ??
          `Voting place ${padElectorateNo(entry.electorateNo)}-${String(entry.placeNo).padStart(3, '0')}`,
        address: place?.address ?? '',
        lat: place?.lat ?? null,
        lon: place?.lon ?? null,
        electorateName: references.nameByNumber.get(entry.electorateNo) ?? null,
        group,
        // A place whose file we could not read is reported as outstanding: it
        // heals on the next request, and claiming a count we did not see would
        // be the worse error.
        countedAt: count?.countedAt ?? null,
      };
    });

    return {
      ...base,
      available: true,
      reason: null,
      counted: places.filter((p) => p.countedAt !== null).length,
      total: places.length,
      places,
    };
  }

  /**
   * Fetch every place file for one seat, through the service-wide budget.
   * Returns null when the budget cannot admit the work, which is reported as
   * `available: false, reason: 'busy'` — never as a seat where every place
   * simply has not counted.
   */
  private async fetchPlaceCounts(
    electorateName: string,
    dir: string,
    entries: Awaited<ReturnType<typeof parseVotingPlaceListing>>
  ): Promise<(ReturnType<typeof parseVotingPlaceResult> | null)[] | null> {
    let cancelled = false;
    try {
      return await mapWithConcurrency(
        entries,
        this.concurrency,
        async (entry) => {
          if (cancelled) return null;
          try {
            const res = await this.budget.run(() =>
              this.fetchText(`${dir}${entry.file}`)
            );
            if (res.status !== 200) return null;
            return parseVotingPlaceResult(res.body);
          } catch (err) {
            if (err instanceof FetchBudgetExceededError) {
              // Stop admitting further work for a response we are about to
              // abandon; in-flight fetches finish and release their slots.
              cancelled = true;
              throw err;
            }
            // A network/parse failure is one outstanding place, not a failed
            // seat: it heals on the next request.
            return null;
          }
        }
      );
    } catch (err) {
      if (err instanceof FetchBudgetExceededError) {
        this.onLog(
          `Voting place fetch budget exhausted for ${electorateName}: ${err.message}`
        );
        return null;
      }
      throw err;
    }
  }

  private ensureReferences(): Promise<References | null> {
    if (this.references && this.referencesExpireAt > this.now()) {
      return Promise.resolve(this.references);
    }
    if (!this.referencesPromise) {
      this.referencesPromise = this.loadReferences()
        .then((value) => {
          if (value) {
            this.references = value;
            this.referencesExpireAt = this.now() + this.referenceTtlMs;
          }
          return value;
        })
        .finally(() => {
          this.referencesPromise = null;
        });
    }
    return this.referencesPromise;
  }

  private async loadReferences(): Promise<References | null> {
    let electoratesBody: string;
    let registerBody: string;
    try {
      const [electorates, register] = await Promise.all([
        this.fetchText(`${this.baseUrl}electorates.xml`),
        this.fetchText(`${this.baseUrl}votingplaces.xml`),
      ]);
      if (electorates.status !== 200 || register.status !== 200) {
        this.onLog(
          `Voting place reference data unavailable (${electorates.status}/${register.status})`
        );
        return null;
      }
      electoratesBody = electorates.body;
      registerBody = register.body;
    } catch (err) {
      this.onLog('Voting place reference data unreachable', err);
      return null;
    }

    const nameByNumber = new Map<number, string>();
    const numberByName = new Map<string, number>();
    const doc = xmlParser.parse(electoratesBody) as {
      electorates?: { electorate?: unknown };
    };
    const entries = toArray<Record<string, unknown>>(
      doc.electorates?.electorate
    );
    for (const record of entries) {
      const no = Number(record.e_no);
      const name =
        typeof record.electorate_name === 'string'
          ? record.electorate_name.trim()
          : '';
      if (!Number.isFinite(no) || !name) continue;
      nameByNumber.set(no, name);
      numberByName.set(normalizeElectorateName(name), no);
    }

    const placeById = new Map<number, VotingPlace>();
    for (const place of parseVotingPlaceRegistry(registerBody)) {
      placeById.set(place.id, place);
    }

    if (numberByName.size === 0) {
      this.onLog('Voting place reference data had no electorates');
      return null;
    }

    return { nameByNumber, numberByName, placeById };
  }
}
