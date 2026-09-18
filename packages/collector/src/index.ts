/**
 * `@election-night/collector` — the collector as a library.
 *
 * The dashboard server imports this and runs the collector in-process; there
 * is no standalone collector process, no Socket.io hop, and no second HTTP
 * server. See `collector.ts` for the loop and `query.ts` for read-only access
 * to the snapshots it writes.
 */

export {
  startCollector,
  stopCollector,
  collectorState,
  type CollectorOptions,
  type CollectorState,
} from './collector.js';
export { createResultsDb, type ResultsDb } from './query.js';
export { collectorConfig } from './config.js';
