import { resolve } from 'path';
import type { ElectorateConfig, ElectionSource } from '@election-night/core/types';
import { NzElectionResultsSource } from '@election-night/core/sources/nz-election-results';
import { log } from './logger.js';
import { collectorConfig } from './config.js';

export type SourceLoadResult = {
  source: ElectionSource;
  configs: ElectorateConfig[];
};

export async function loadSource(
  electorateNames: string[]
): Promise<SourceLoadResult> {
  const sourcePath = collectorConfig.electionSourcePath;

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
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to load source from ${resolvedPath}`, err);
      throw new Error(
        `ELECTION_SOURCE_PATH is set but the source could not be loaded: ${message}`
      );
    }
  }

  const source = new NzElectionResultsSource({
    baseUrl: collectorConfig.baseResultsUrl,
    electorateNames,
    resultsTableSelector: collectorConfig.resultsTableSelector,
    candidateTableSelector: collectorConfig.candidateTableSelector,
    partyVoteTableSelector: collectorConfig.partyVoteTableSelector,
    votePercentCountedSelector: collectorConfig.votePercentCountedSelector,
    votesCountedSelector: collectorConfig.votesCountedSelector,
    verbose: collectorConfig.logLevel < 3,
  });
  const configs = source.getElectorateConfigs();
  return { source, configs };
}
