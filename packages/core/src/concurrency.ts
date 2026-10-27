/**
 * Fixed-width concurrency, in one place.
 *
 * Both processes fan out over a ~70-file cycle — the collector fetching an
 * electorate's results, and `ElectionResultsService` fetching an archived
 * cycle — so the shape "run this over that list, but never more than N at
 * once" appears on both sides of the package boundary. It is small enough to
 * look harmless twice; it is not harmless twice, because the failure mode is
 * a rate limit mid-cycle and only one copy gets the fix.
 *
 * `mapWithConcurrency` rejects on the first failure (a partially fetched cycle
 * is not a result worth keeping), and `mapSettledWithConcurrency` returns the
 * settled array so a caller can fall back per item — the scrape loop keeps the
 * previous poll's copy of any electorate that failed.
 */

/** One item's outcome from `mapSettledWithConcurrency`, in the caller's order. */
export type Settled<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 *
 * Workers are claimed by a shared cursor rather than sliced into batches, so a
 * slow request does not idle the rest of the pool.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** `mapWithConcurrency` without short-circuiting: every item yields a result. */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Settled<R>[]> {
  return mapWithConcurrency(
    items,
    limit,
    async (item, index): Promise<Settled<R>> => {
      try {
        return { status: 'fulfilled', value: await worker(item, index) };
      } catch (reason) {
        return { status: 'rejected', reason };
      }
    }
  );
}
