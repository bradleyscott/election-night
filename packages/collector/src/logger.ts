import { Logger } from 'tslog';
import { collectorConfig } from './config.js';

export const log = new Logger({ minLevel: collectorConfig.logLevel });
