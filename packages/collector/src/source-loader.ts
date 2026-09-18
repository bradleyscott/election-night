import { isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import type {
  ElectorateConfig,
  ElectionSource,
  PartyList,
} from '@election-night/core/types';
import { NzElectionXmlSource } from '@election-night/core/sources';
import { log } from './logger.js';
import { collectorConfig } from './config.js';

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
  partyListRecords: PartyList[];
};

async function loadCustomSource(sourcePath: string): Promise<SourceLoadResult> {
  const resolvedPath = validateSourcePath(sourcePath);
  log.info(`Loading custom election source from: ${resolvedPath}`);
  const mod = await import(resolvedPath);
  const SourceClass = mod.default ?? mod.NzElectionXmlSource;
  const source = new SourceClass({}) as ElectionSource;
  const [configs, partyListRecords] = await Promise.all([
    source.loadElectorates(),
    source.loadPartyList(),
  ]);
  log.info(`Loaded custom source with ${configs.length} electorates`);
  return { source, configs, partyListRecords };
}

export async function loadSource(): Promise<SourceLoadResult> {
  const sourcePath = collectorConfig.electionSourcePath;
  if (sourcePath) {
    try {
      return await loadCustomSource(sourcePath);
    } catch (err) {
      log.error(
        `Failed to load custom source from ${sourcePath}, falling back to the XML feed`,
        err
      );
    }
  }

  const verbose = collectorConfig.logLevel < 3;
  const source = new NzElectionXmlSource({
    year: collectorConfig.electionYear,
    baseUrl: collectorConfig.xmlFeedBaseUrl,
    timeoutMs: collectorConfig.fetchTimeoutMs,
    verbose,
  });
  const [configs, partyListRecords] = await Promise.all([
    source.loadElectorates(),
    source.loadPartyList(),
  ]);
  log.info(`Loaded XML source with ${configs.length} electorates`);
  return { source, configs, partyListRecords };
}
