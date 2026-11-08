/**
 * Webhook delivery, decoupled from the count.
 *
 * Announcements are persisted in the same transaction as the snapshot (see
 * `buildWebhookPayloads` and `SnapshotWrite.webhooks`), then this loop claims
 * due rows and posts them. The collection path never waits for a receiver, so
 * a hung endpoint cannot delay the result the dashboard is showing.
 *
 * Delivery is at-least-once: a lost response after the receiver accepted the
 * request is retried. The payload carries a stable `eventId`, so the receiver
 * is expected to deduplicate. Retries are bounded; a permanent 4xx or an
 * exhausted retry budget becomes a dead letter rather than a busy loop.
 */

import { mapWithConcurrency } from '@election-night/core/concurrency';
import type { DbWorkerClient } from './db-worker-client.js';
import type { WebhookOutboxRow } from './db.js';
import { log } from './logger.js';
import { emitWebhookPublish } from './metrics.js';
import { publishMetrics } from './ws-client.js';

export type WebhookOutboxOptions = {
  /** Receiver URL; the outbox is not created when this is empty. */
  url: string;
  /** Concurrent POSTs (default 4). */
  concurrency?: number;
  /** Per-request deadline covering the body (default 10s). */
  requestTimeoutMs?: number;
  /** Attempts before a row is dead-lettered (default 6). */
  maxAttempts?: number;
  /** How often the loop looks for due rows (default 5s). */
  intervalMs?: number;
  /** Rows claimed per tick (default 20). */
  pageSize?: number;
};

export type WebhookOutbox = {
  start: () => void;
  stop: () => void;
  tick: () => Promise<void>;
};

function retryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

export function createWebhookOutbox(
  client: DbWorkerClient,
  options: WebhookOutboxOptions
): WebhookOutbox {
  const concurrency = options.concurrency ?? 4;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 6;
  const intervalMs = options.intervalMs ?? 5_000;
  const pageSize = options.pageSize ?? 20;

  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function deliver(row: WebhookOutboxRow): Promise<void> {
    const startedAt = performance.now();
    try {
      const res = await fetch(options.url, {
        method: 'POST',
        body: row.payload,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      // Consume the body so the connection is released.
      await res.text().catch(() => undefined);
      const seconds = (performance.now() - startedAt) / 1000;

      if (res.ok) {
        await client.completeWebhook(row.id, 'delivered');
        publishMetrics(emitWebhookPublish('success'));
        log.info(
          `Webhook ${row.event} for revision ${row.revision ?? 'legacy'} delivered after ${row.attempts} attempt(s) (${seconds.toFixed(1)}s)`
        );
        return;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || row.attempts >= maxAttempts) {
        await client.completeWebhook(row.id, 'dead', {
          error: `HTTP ${res.status}`,
        });
        publishMetrics(emitWebhookPublish('error'));
        log.error(
          `Webhook ${row.event} for revision ${row.revision ?? 'legacy'} dead-lettered after HTTP ${res.status} (attempt ${row.attempts})`
        );
        return;
      }

      const delay = retryDelayMs(row.attempts);
      await client.completeWebhook(row.id, 'retry', {
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        error: `HTTP ${res.status}`,
      });
      publishMetrics(emitWebhookPublish('error'));
      log.warn(
        `Webhook ${row.event} got HTTP ${res.status}; retrying in ${Math.round(delay / 1000)}s (attempt ${row.attempts}/${maxAttempts})`
      );
    } catch (err) {
      if (stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      if (row.attempts >= maxAttempts) {
        await client.completeWebhook(row.id, 'dead', { error: message });
        publishMetrics(emitWebhookPublish('error'));
        log.error(
          `Webhook ${row.event} dead-lettered after ${row.attempts} attempts: ${message}`
        );
        return;
      }
      const delay = retryDelayMs(row.attempts);
      await client.completeWebhook(row.id, 'retry', {
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        error: message,
      });
      publishMetrics(emitWebhookPublish('error'));
      log.warn(
        `Webhook ${row.event} failed (${message}); retrying in ${Math.round(delay / 1000)}s (attempt ${row.attempts}/${maxAttempts})`
      );
    }
  }

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      const rows = await client.claimWebhooks(pageSize);
      await mapWithConcurrency(rows, concurrency, deliver);
    } catch (err) {
      log.warn('Webhook outbox tick failed', err);
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (stopped) return;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    timer.unref?.();
  }

  function stop(): void {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}
