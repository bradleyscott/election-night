import { Logger } from 'tslog';

const minLevel = parseInt(process.env.LOG_LEVEL ?? '', 10) || 3;
export const log = new Logger({ minLevel });
