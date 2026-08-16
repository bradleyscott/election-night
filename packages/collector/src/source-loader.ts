import { isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import type { ElectorateConfig, ElectionSource } from '@election-night/core/types';
import { NzElectionResultsSource } from '@election-night/core/sources/nz-election-results';
import { log } from './logger.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

function validateSourcePath(sourcePath: string): string {
  if (isAbsolute(sourcePath)) {
    throw new Error(
      `ELECTION_SOURCE_PATH must be a relative path, got absolute path: ${sourcePath}`
    );
  }
  if (sourcePath.includes('..')) {
    throw new Error(
      `ELECTION_SOURCE_PATH must not contain parent directory references: ${sourcePath}`
    );
  }
  if (!/\.(ts|js)$/i.test(sourcePath)) {
    throw new Error(
      `ELECTION_SOURCE_PATH must point to a .ts or .js file: ${sourcePath}`
    );
  }
  const resolvedPath = resolve(process.cwd(), sourcePath);
  if (!resolvedPath.startsWith(REPO_ROOT + sep)) {
    throw new Error(
      `ELECTION_SOURCE_PATH must resolve inside the repository: ${resolvedPath}`
    );
  }
  return resolvedPath;
}

export type SourceLoadResult = {
  source: ElectionSource;
  configs: ElectorateConfig[];
};

export async function loadSource(
  electorateNames: string[]
): Promise<SourceLoadResult> {
  const sourcePath = process.env.ELECTION_SOURCE_PATH;

  if (sourcePath) {
    const resolvedPath = validateSourcePath(sourcePath);
    log.info(`Loading custom election source from: ${resolvedPath}`);
    try {
      const mod = await import(resolvedPath);
      const SourceClass = mod.default ?? mod.NzElectionResultsSource;
      const source = new SourceClass({ electorateNames }) as ElectionSource;
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
