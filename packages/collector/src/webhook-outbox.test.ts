import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWebhookOutbox } from './webhook-outbox.js';
import type { DbWorkerClient } from './db-worker-client.js';
import type { WebhookOutboxRow } from './db.js';

function row(id: number, attempts = 0): WebhookOutboxRow {
  return {
    id,
    eventId: `event-${id}`,
    electionYear: '2026',
    revision: 1,
    event: 'result_updated',
    payload: JSON.stringify({ event: 'result_updated', id }),
    attempts,
    nextAttemptAt: '2026-11-07T07:00:00.000Z',
  };
}

function fakeClient(rows: WebhookOutboxRow[]) {
  const completed: {
    id: number;
    outcome: string;
    options: { nextAttemptAt?: string; error?: string | null };
  }[] = [];
  const client = {
    claimWebhooks: vi.fn(async () => rows.splice(0)),
    completeWebhook: vi.fn(
      async (
        id: number,
        outcome: string,
        options: { nextAttemptAt?: string; error?: string | null } = {}
      ) => {
        completed.push({ id, outcome, options });
        return null;
      }
    ),
  } as unknown as DbWorkerClient;
  return { client, completed };
}

function response(status: number): Response {
  return new Response('', { status });
}

describe('webhook outbox delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('delivers a successful post', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(200))
    );
    const { client, completed } = fakeClient([row(1)]);

    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
    });
    await outbox.tick();

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ id: 1, outcome: 'delivered' });
  });

  test('retries a temporary 5xx or 429 with backoff', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(503))
    );
    const { client, completed } = fakeClient([row(1)]);

    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
      maxAttempts: 6,
    });
    await outbox.tick();

    expect(completed[0]!.outcome).toBe('retry');
    expect(
      new Date(completed[0]!.options.nextAttemptAt!).getTime()
    ).toBeGreaterThan(Date.now());
  });

  test('dead-letters a permanent 4xx without retrying', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(404))
    );
    const { client, completed } = fakeClient([row(1)]);

    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
    });
    await outbox.tick();

    expect(completed[0]!.outcome).toBe('dead');
    expect(completed[0]!.options.error).toContain('404');
  });

  test('times out a hanging receiver and retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('timed out'))
            );
          })
      )
    );
    const { client, completed } = fakeClient([row(1)]);

    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
      requestTimeoutMs: 20,
    });
    await outbox.tick();

    expect(completed[0]!.outcome).toBe('retry');
  });

  test('dead-letters after the retry budget is exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(500))
    );
    const { client, completed } = fakeClient([row(5, 3)]);

    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
      maxAttempts: 3,
    });
    await outbox.tick();

    expect(completed[0]!.outcome).toBe('dead');
  });

  test('start() does not wait for a hanging receiver', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(() => {
            /* never settles */
          })
      )
    );
    const { client } = fakeClient([row(1)]);

    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
      requestTimeoutMs: 10_000,
    });
    const started = performance.now();
    outbox.start();
    const elapsed = performance.now() - started;

    // The loop is scheduled, not awaited.
    expect(elapsed).toBeLessThan(100);
    outbox.stop();
  });

  test('stop() prevents a subsequent tick from claiming work', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(200))
    );
    const { client } = fakeClient([row(1)]);
    const outbox = createWebhookOutbox(client, {
      url: 'https://hooks.example.com',
      intervalMs: 60_000,
    });

    outbox.stop();
    await outbox.tick();

    expect(client.claimWebhooks).not.toHaveBeenCalled();
  });
});
