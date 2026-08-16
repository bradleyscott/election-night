/**
 * A simple async mutex: one task holds the lock at a time; later tasks wait
 * in FIFO order. Used to serialize operations that touch shared module state
 * (latestResults and feedEvents).
 */
export class Mutex {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    const previous = this.promise;
    let release: () => void;
    this.promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release!;
  }
}

/**
 * Convenience helper that runs `fn` while holding `mutex`.
 */
export async function withMutex<T>(
  mutex: Mutex,
  fn: () => Promise<T> | T
): Promise<T> {
  const release = await mutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
