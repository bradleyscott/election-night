import type { Config } from './types.js';

/**
 * The only genuinely cross-package runtime value. Package-specific config
 * lives with the package: the collector reads `collectorConfig`
 * (`packages/collector/src/config.ts`), the dashboard server reads
 * `dashboardServerConfig`. Scraping selectors/URLs belong to the source
 * adapter (`NzElectionResultsSource`), not shared config.
 */
export const config: Config = {
  predictionConfidence: 0.95,
};
