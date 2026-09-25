import { sampleDiskUsage } from './metrics.js';

/**
 * Retention policy for the scrape history.
 *
 * Snapshots are pruned on startup and then swept periodically for as long as
 * the process runs — a production collector is expected to run for weeks
 * (`min_machines_running = 1`), so a startup-only prune would never fire again
 * after the very first boot and the volume would fill exactly once per deploy
 * cycle. The SQL lives in `db.ts` (`pruneSnapshots`, `compactDatabase`); what
 * is decided here is *when* to sweep and *how much* to keep.
 */

/**
 * Free-space share below which the configured window is abandoned for
 * `PRESSURE_KEEP_HOURS`. A database that cannot be written serves nothing at
 * all, so dropping older history is the better failure.
 */
export const LOW_DISK_FRACTION = 0.05;

/** Window used while the volume is under pressure, in hours. */
export const PRESSURE_KEEP_HOURS = 1;

export type DiskSample = { path: string; size: number; available: number } | null;

export function sampleDisk(dbPath: string): DiskSample {
  return sampleDiskUsage(dbPath);
}

export function isUnderDiskPressure(sample: DiskSample): boolean {
  if (!sample || sample.size <= 0) return false;
  return sample.available / sample.size < LOW_DISK_FRACTION;
}

/**
 * Hours of history to keep right now: the configured window, or a much shorter
 * one when the volume is nearly full. `0` (retention disabled) always wins —
 * pruning is opt-in, and the emergency floor is not a second way to enable it.
 */
export function effectiveKeepHours(
  configuredHours: number,
  sample: DiskSample
): number {
  if (configuredHours <= 0) return 0;
  if (!isUnderDiskPressure(sample)) return configuredHours;
  return Math.min(configuredHours, PRESSURE_KEEP_HOURS);
}

/**
 * Whether a sweep is due. `intervalMs <= 0` disables periodic sweeps, leaving
 * only the startup prune.
 */
export function shouldSweep(
  lastSweepAt: number | null,
  now: number,
  intervalMs: number
): boolean {
  if (intervalMs <= 0) return false;
  if (lastSweepAt === null) return true;
  return now - lastSweepAt >= intervalMs;
}

export function describeSweep(summary: {
  deletedSnapshots: number;
  freedPages: number;
  keepHours: number;
  underPressure: boolean;
}): string {
  const parts = [
    `pruned ${summary.deletedSnapshots} snapshot(s) older than ${summary.keepHours}h`,
    `reclaimed ${summary.freedPages} page(s)`,
  ];
  if (summary.underPressure) parts.push('volume below threshold');
  return `Retention: ${parts.join(', ')}`;
}
