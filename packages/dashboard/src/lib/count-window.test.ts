import { describe, expect, test } from 'vitest';
import { trimAtCountComplete } from './count-window.js';

/** A history point reduced to the one field the trim reads. */
function at(votePctCounted: number) {
  return { votePctCounted };
}

describe('trimAtCountComplete', () => {
  test('keeps the point that reached 100% and drops the flat tail after it', () => {
    const history = [0.5, 0.9, 1, 1, 1].map(at);

    expect(trimAtCountComplete(history)).toEqual(history.slice(0, 3));
  });

  test('keeps every point while the count is still short of 100%', () => {
    const history = [0.5, 0.9, 0.99].map(at);

    expect(trimAtCountComplete(history)).toBe(history);
  });

  test('does not treat a count that rounds to 100% as complete', () => {
    // The feed genuinely publishes 99.989% just before the last places report:
    // the readout prints 100.0%, but the count has not finished and the point
    // that finishes it is still to come.
    const history = [0.99989].map(at);

    expect(trimAtCountComplete(history)).toBe(history);
  });

  test('keeps a series whose first point is already complete', () => {
    const history = [1, 1].map(at);

    expect(trimAtCountComplete(history)).toEqual(history.slice(0, 1));
  });

  test('handles an empty series', () => {
    expect(trimAtCountComplete([])).toEqual([]);
  });
});
