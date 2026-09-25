import type { PredictionStatus } from '@election-night/core/types';

/**
 * The one place projection status is turned into words and colour, so the
 * electorate page, Close Calls and Flipped cannot drift into describing the
 * same status differently. `projected` and `likely` read the same to a reader
 * ("this one is over"), which is why they share a label.
 */
export function predictionStatusLabel(
  status: PredictionStatus | string | null | undefined
): string {
  if (status === 'projected' || status === 'likely') return 'Likely winner';
  if (status === 'leaning') return 'Leaning';
  return 'Too close to call';
}

export function predictionStatusClass(
  status: PredictionStatus | string | null | undefined
): string {
  if (status === 'projected' || status === 'likely') {
    return 'text-green-700 dark:text-green-400';
  }
  if (status === 'leaning') return 'text-orange-700 dark:text-orange-400';
  return 'text-amber-700 dark:text-amber-400';
}
