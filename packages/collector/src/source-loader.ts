import { resolve } from 'path';
import type { ElectorateConfig, ElectionSource } from '@election-night/core/types';
import { NzElectionResultsSource } from '@election-night/core/sources/nz-election-results';
import { log } from './logger.js';

export type SourceLoadResult = {
  source: ElectionSource;
  configs: ElectorateConfig[];
};

export async function loadSource(
  electorateNames: string[]
): Promise<SourceLoadResult> {
  const sourcePath = process.env.ELECTION_SOURCE_PATH;

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
      log.error(
        `Failed to load source from ${resolvedPath}, falling back to default`,
        err
      );
    }
  }

  const verbose = parseInt(process.env.LOG_LEVEL ?? '', 10) < 3;
  const source = new NzElectionResultsSource({ electorateNames, verbose });
  const configs = source.getElectorateConfigs();
  return { source, configs };
}
