import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  startCollectorWatchdog,
  watchdogEnabledFromEnv,
  type WatchdogLogger,
} from './collector-watchdog.js';

const silent: WatchdogLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('watchdogEnabledFromEnv', () => {
  const base = {
    NODE_ENV: 'production',
    COLLECTOR_ENABLED: 'true',
  } as NodeJS.ProcessEnv;

  it('runs in the combined production deployment', () => {
    expect(watchdogEnabledFromEnv(base)).toBe(true);
  });

  it('does not run outside production', () => {
    expect(watchdogEnabledFromEnv({ ...base, NODE_ENV: 'development' })).toBe(
      false
    );
  });

  it('does not run when the collector is disabled or absent', () => {
    expect(
      watchdogEnabledFromEnv({ ...base, COLLECTOR_ENABLED: 'false' })
    ).toBe(false);
    const { COLLECTOR_ENABLED: _, ...without } = base;
    expect(watchdogEnabledFromEnv(without)).toBe(false);
  });

  it('can be switched off without changing the deployment', () => {
    expect(watchdogEnabledFromEnv({ ...base, COLLECTOR_WATCHDOG: 'off' })).toBe(
      false
    );
  });
});

describe('startCollectorWatchdog', () => {
  it('exits once after the configured number of consecutive failures', async () => {
    const onFatal = vi.fn();
    const probe = vi.fn().mockResolvedValue(false);
    const watchdog = startCollectorWatchdog({
      baseUrl: 'http://127.0.0.1:1',
      probe,
      intervalMs: 5,
      timeoutMs: 5,
      failuresBeforeRestart: 3,
      graceMs: 0,
      onFatal,
      log: silent,
    });

    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
    });
    expect(probe).toHaveBeenCalledTimes(3);
    // A fatal watchdog stops probing; it must not keep calling onFatal.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(3);

    watchdog.stop();
  });

  it('resets the failure count when a probe succeeds', async () => {
    // Two failures, a success, then two more: never three in a row.
    const results = [false, false, true, false, false];
    const onFatal = vi.fn();
    const probe = vi.fn(() =>
      Promise.resolve(results.length > 0 ? results.shift()! : true)
    );
    const watchdog = startCollectorWatchdog({
      baseUrl: 'http://127.0.0.1:1',
      probe,
      intervalMs: 5,
      timeoutMs: 5,
      failuresBeforeRestart: 3,
      graceMs: 0,
      onFatal,
      log: silent,
    });

    await vi.waitFor(() => expect(probe.mock.calls.length).toBeGreaterThan(4), {
      timeout: 1_000,
    });
    expect(onFatal).not.toHaveBeenCalled();

    watchdog.stop();
  });

  it('does not probe during the startup grace period', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const watchdog = startCollectorWatchdog({
      baseUrl: 'http://127.0.0.1:1',
      probe,
      intervalMs: 5,
      failuresBeforeRestart: 1,
      graceMs: 60_000,
      log: silent,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(probe).not.toHaveBeenCalled();
    watchdog.stop();
  });

  it('stop() prevents any further probes', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const watchdog = startCollectorWatchdog({
      baseUrl: 'http://127.0.0.1:1',
      probe,
      intervalMs: 5,
      failuresBeforeRestart: 100,
      graceMs: 0,
      log: silent,
    });

    watchdog.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(probe).not.toHaveBeenCalled();
  });

  it('defaults to exiting the process so the supervisor restarts it', async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const watchdog = startCollectorWatchdog({
      baseUrl: 'http://127.0.0.1:1',
      probe: () => Promise.resolve(false),
      intervalMs: 5,
      failuresBeforeRestart: 1,
      graceMs: 0,
      log: silent,
    });

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), {
      timeout: 1_000,
    });
    watchdog.stop();
    exit.mockRestore();
  });

  it('probes the collector /health endpoint over HTTP', async () => {
    let status = 200;
    let hang = false;
    const { server, baseUrl } = await listen((_req, res) => {
      if (hang) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    });

    const watchdog = startCollectorWatchdog({
      baseUrl,
      timeoutMs: 50,
      graceMs: 60_000,
      log: silent,
    });

    try {
      expect(await watchdog.probe()).toBe(true);

      status = 503;
      expect(await watchdog.probe()).toBe(false);

      hang = true;
      expect(await watchdog.probe()).toBe(false);
    } finally {
      watchdog.stop();
      await close(server);
    }
  });
});
