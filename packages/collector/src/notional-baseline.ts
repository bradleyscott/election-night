import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NotionalBaseline } from '@election-night/core/notional-baseline';

/**
 * Read a generated notional baseline from `@election-night/core/data/`.
 *
 * A file rather than an import: the collector runs from source under `tsx` and
 * from `dist/` in production, and the path has to be the same either way. The
 * browser bundle imports the same JSON directly instead — it has no filesystem.
 */
export function loadNotionalBaseline(
  year: string | number | null | undefined
): NotionalBaseline | null {
  if (year === null || year === undefined || year === '') return null;
  const file = fileURLToPath(
    new URL(
      `../../core/data/notional-baseline-${String(year)}.json`,
      import.meta.url
    )
  );
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as NotionalBaseline;
  } catch {
    return null;
  }
}
