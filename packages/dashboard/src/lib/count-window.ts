/**
 * A history series ends where the count did.
 *
 * The collector keeps polling after the last voting place has reported, and a
 * snapshot is written whenever the payload moves for any reason — a late
 * special vote, a party list adjustment. The count itself is already 100%, so
 * those snapshots are a flat tail from the end of the night to the present,
 * and a chart drawn over the whole response squeezes the hours that matter
 * into the left edge of its axis.
 *
 * A count that has reached 100% is finished: keep every point up to and
 * including the first one that says so. The series is returned untouched while
 * no point has reached 100%, so a live count still draws to its latest scrape.
 *
 * 100% means exactly 100%, not a value that rounds to it: the feed can publish
 * 99.989% (which the one-decimal readout prints as 100.0%) with places still
 * to report, and cutting there would hide the snapshot that actually finished
 * the count. `votePctCounted` is a share of the expected final vote and is
 * written as 1 by the seat model once every place has reported.
 */
export function trimAtCountComplete<T extends { votePctCounted: number }>(
  points: T[]
): T[] {
  const completeAt = points.findIndex((point) => point.votePctCounted >= 1);
  return completeAt === -1 ? points : points.slice(0, completeAt + 1);
}
