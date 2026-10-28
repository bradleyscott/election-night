import { Logger } from 'tslog';

// Fly/Grafana split a pretty log line at every \n, so an error stack arrives as a
// dozen orphaned log entries. JSON mode keeps one call = one line in production;
// pretty output stays the default for local dev. LOG_FORMAT=json|pretty overrides.
const json =
  process.env.LOG_FORMAT === 'json' ||
  (process.env.LOG_FORMAT !== 'pretty' && process.env.NODE_ENV === 'production');

export const log = new Logger({
  minLevel: parseInt(process.env.LOG_LEVEL ?? '3', 10),
  type: json ? 'json' : 'pretty',
});
