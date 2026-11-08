/**
 * Restart the machine when the collector's HTTP surface stops answering.
 *
 * A collector can keep scraping, writing snapshots and publishing over
 * Socket.io while its `/health`, `/metrics` and `/history/*` listener is wedged
 * — the process is alive, the socket is bound, and `server.on('error')` never
 * fires. That is invisible from the dashboard's `/health` (it answers for
 * itself), so the original failure mode was a chart frozen on its last cached
 * snapshot for hours with no restart and no alert.
 *
 * This watchdog lives in the dashboard process, whose event loop is
 * independent of the collector's, and probes the collector's `/health` over
 * loopback. `/health` is deliberate: it is synchronous and never touches
 * SQLite, so it is the cheapest possible "is the HTTP surface awake?" question.
 * After `failuresBeforeRestart` consecutive failures it exits the dashboard,
 * which `docker/entrypoint.sh` treats as fatal (`wait -n` on either process);
 * the orchestrator then restarts the machine.
 *
 * Two minutes of startup grace keeps a booting collector (which loads the
 * reference data before it starts listening) from tripping the watchdog, and
 * six failures at ten-second intervals means a transiently busy event loop is
 * not enough to restart a healthy machine.
 */

import { log as defaultLog } from './logger.js';
import {
  collectorHealthProbeFailuresTotal,
  collectorHealthProbeLastSuccess,
} from './metrics.js';

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_FAILURES_BEFORE_RESTART = 6;
const DEFAULT_GRACE_MS = 120_000;

export interface WatchdogLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface CollectorWatchdogOptions {
  /** Base URL of the collector's HTTP surface (`HISTORY_UPSTREAM`). */
  baseUrl: string;
  /** Time between probes once the grace period is over. */
  intervalMs?: number;
  /** How long one `/health` request may take before it counts as a failure. */
  timeoutMs?: number;
  /** Consecutive failures before the dashboard exits. */
  failuresBeforeRestart?: number;
  /** Delay before the first probe, so a booting collector is not killed. */
  graceMs?: number;
  /** Injected for tests; defaults to fetching `<baseUrl>/health`. */
  probe?: () => Promise<boolean>;
  /** Injected for tests; defaults to logging and `process.exit(1)`. */
  onFatal?: (message: string) => void;
  /** Injected for tests; defaults to the server logger. */
  log?: WatchdogLogger;
}

export interface CollectorWatchdog {
  /** Stop probing, e.g. on a graceful shutdown. */
  stop(): void;
  /** One probe, without changing the failure count. Exposed for tests. */
  probe(): Promise<boolean>;
}

/**
 * Whether this process is the combined dashboard + collector deployment that
 * should supervise the collector. A split deployment (dashboard only) must set
 * `COLLECTOR_ENABLED=true` explicitly to opt in, because the watchdog's remedy
 * — exiting the dashboard so the entrypoint restarts the machine — only helps
 * when both processes share that machine.
 */
export function watchdogEnabledFromEnv(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.NODE_ENV === 'production' &&
    env.COLLECTOR_ENABLED === 'true' &&
    env.COLLECTOR_WATCHDOG !== 'off'
  );
}

/**
 * One bounded question to the collector's HTTP surface: does `/health` answer?
 *
 * Shared by the watchdog and `/ready` so the readiness answer is produced by
 * the same probe that would restart the machine, never by a cached history
 * value. `/health` is synchronous and does not touch SQLite, so it tests the
 * listener rather than the writer.
 */
export async function probeCollectorHealth(
  baseUrl: string,
  timeoutMs = 3_000
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Consume the tiny body so the keep-alive socket is released.
    await res.text();
    return res.ok;
  } catch {
    return false;
  }
}

export function startCollectorWatchdog(
  options: CollectorWatchdogOptions
): CollectorWatchdog {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const failuresBeforeRestart =
    options.failuresBeforeRestart ?? DEFAULT_FAILURES_BEFORE_RESTART;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const log = options.log ?? defaultLog;

  const probe =
    options.probe ?? (() => probeCollectorHealth(baseUrl, timeoutMs));
  const onFatal =
    options.onFatal ??
    ((message: string) => {
      log.error(message);
      process.exit(1);
    });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let failures = 0;

  function stop(): void {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(run, delayMs);
    // The HTTP server keeps the process alive; the watchdog timer alone should
    // not (and tests can stop it without waiting for the grace period).
    timer.unref?.();
  }

  async function run(): Promise<void> {
    timer = null;
    if (stopped) return;

    const ok = await probe();
    if (stopped) return;

    if (ok) {
      if (failures > 0) {
        log.info(
          `Collector health probe recovered after ${failures} consecutive failure(s)`
        );
      }
      failures = 0;
      collectorHealthProbeLastSuccess.set(Date.now() / 1000);
      schedule(intervalMs);
      return;
    }

    failures += 1;
    collectorHealthProbeFailuresTotal.inc();
    log.warn(
      `Collector health probe failed (${failures}/${failuresBeforeRestart}): ${baseUrl}/health did not answer within ${timeoutMs}ms`
    );

    if (failures >= failuresBeforeRestart) {
      stop();
      onFatal(
        `Collector health probe failed ${failures} consecutive times at ${baseUrl}/health; exiting so the supervisor restarts the machine`
      );
      return;
    }

    schedule(intervalMs);
  }

  schedule(graceMs);

  return { stop, probe };
}
