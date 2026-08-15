import { Logger } from 'tslog';

export const log = new Logger({
  minLevel: parseInt(process.env.LOG_LEVEL ?? '3', 10),
});
