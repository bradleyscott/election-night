/**
 * The collector's wiring of `ElectionResultsService`: the configured connector,
 * which cycles are probed, and how its logging reaches the collector's logger.
 */

import { ElectionResultsService } from '@election-night/core/election-results-service';
import { NzElectionXmlSource } from '@election-night/core/sources';
import { collectorConfig } from './config.js';
import { log } from './logger.js';

/**
 * A connector for a nominated year, or `null` when this deployment cannot
 * serve that year.
 *
 * `XML_FEED_BASE_URL` points at a mock feed that replays exactly one cycle, so
 * it is only ever used for the cycle being counted. Answering a prior year
 * from it would silently label tonight's candidates as the last election's
 * winners, which the UI could not detect.
 *
 * A prior year therefore goes to the archive, which is the authority for it and
 * needs no override: the year in the URL *is* the cycle. Falling back rather
 * than refusing keeps a mocked run able to fill in /flipped and the per-seat
 * past-winners table with real winners, instead of blanking every comparison
 * because tonight's feed is synthetic.
 */
export function createSourceForYear(year: string) {
  const { electionYear, xmlFeedBaseUrl, fetchTimeoutMs, priorResults } =
    collectorConfig;

  if (priorResults === 'off' && year !== electionYear) return null;

  if (xmlFeedBaseUrl && year === electionYear) {
    return new NzElectionXmlSource({
      year,
      baseUrl: xmlFeedBaseUrl,
      timeoutMs: fetchTimeoutMs,
    });
  }

  return new NzElectionXmlSource({ year, timeoutMs: fetchTimeoutMs });
}

export function createResultsService(): ElectionResultsService {
  return new ElectionResultsService({
    currentYear: collectorConfig.electionYear,
    createSource: createSourceForYear,
    // Only picks which cycle the Flipped page compares against; every older
    // cycle is still probed, because the past-winners table on the electorate
    // page wants as far back as the archive goes.
    preferredPriorYear: collectorConfig.priorElectionYear,
    concurrency: collectorConfig.concurrency,
    fetchPacingMs: collectorConfig.fetchPacingMs,
    onLog: (level, message, error) =>
      level === 'warn' ? log.warn(message, error ?? '') : log.info(message),
  });
}
