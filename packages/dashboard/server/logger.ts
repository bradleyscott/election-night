import { Logger } from 'tslog';
import { dashboardServerConfig } from './config.js';

export const log = new Logger({ minLevel: dashboardServerConfig.logLevel });
