import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { evaluateReady, serveReady } from './health.js';

function fakeResponse(): {
  res: ServerResponse;
  captured: { status: number; body: string };
} {
  const captured = { status: 0, body: '' };
  const res = {
    setHeader: () => res,
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(chunk?: unknown) {
      captured.body = chunk === undefined ? '' : String(chunk);
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

const emptyIdentity = async () => ({
  source: null,
  cacheYear: null,
  electionYear: null,
});

describe('serveReady /ready behavior', () => {
  it('returns ready=true when upstream is reachable even without feed events', () => {
    expect(evaluateReady(true, 'none')).toEqual({
      ready: true,
      checks: { history: 'upstream', lastScrape: 'none' },
    });
  });

  it('returns ready=false when upstream is unreachable', () => {
    expect(evaluateReady(false, 'none')).toEqual({
      ready: false,
      checks: { history: 'error', lastScrape: 'none' },
    });
  });

  it('includes the last feed event timestamp when feed events exist', () => {
    expect(evaluateReady(true, 12345)).toEqual({
      ready: true,
      checks: { history: 'upstream', lastScrape: 12345 },
    });
  });

  it('still reports lastScrape when upstream is unreachable', () => {
    expect(evaluateReady(false, 67890)).toEqual({
      ready: false,
      checks: { history: 'error', lastScrape: 67890 },
    });
  });
});

describe('serveReady dependency verification', () => {
  it('is ready only when the collector /health probe answers', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const { res, captured } = fakeResponse();

    await serveReady({} as IncomingMessage, res, [], {
      probe,
      identity: emptyIdentity,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(captured.status).toBe(200);
    expect(JSON.parse(captured.body)).toMatchObject({
      ready: true,
      checks: { history: 'upstream' },
    });
  });

  it('is not ready when the probe fails, even though identity data exists', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const { res, captured } = fakeResponse();

    await serveReady({} as IncomingMessage, res, [], {
      probe,
      identity: async () => ({
        source: 'NZ Election XML Feed',
        cacheYear: '2026',
        electionYear: '2026',
      }),
    });

    expect(captured.status).toBe(503);
    expect(JSON.parse(captured.body)).toMatchObject({
      ready: false,
      checks: { history: 'error' },
    });
  });

  it('uses the probe rather than a history snapshot read', async () => {
    // The only way a cached history value could make this pass is if the
    // readiness check read history at all. It must ask the HTTP surface.
    const probe = vi.fn().mockResolvedValue(false);
    const identity = vi.fn(emptyIdentity);
    const { res } = fakeResponse();

    await serveReady({} as IncomingMessage, res, [], { probe, identity });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(identity).toHaveBeenCalledTimes(1);
  });
});
