// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type { RuntimeConfig } from '@election-night/core/polls-close';
import Layout from './Layout.js';

const CLOSES_AT = '2026-11-07T06:00:00.000Z'; // 7:00pm NZDT on election day

/** Return the mocked `/api/config` payload, or fail every request. */
function mockConfig(
  body: Partial<RuntimeConfig> = {},
  { fail = false }: { fail?: boolean } = {}
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (fail) throw new Error('config unavailable');
      if (url === '/api/config') {
        return {
          ok: true,
          json: async () => ({
            electionYear: '2026',
            pollsCloseAt: CLOSES_AT,
            serverTime: new Date().toISOString(),
            ...body,
          }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    })
  );
}

/** Flush the config fetch without letting the (fake) clock move. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

function renderLayout() {
  return render(
    <BrowserRouter>
      <Layout>
        <div />
      </Layout>
    </BrowserRouter>
  );
}

describe('masthead dateline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('counts down to polls close for the cycle the server is serving', async () => {
    vi.setSystemTime(new Date('2026-11-07T02:00:00Z'));
    mockConfig();

    renderLayout();
    await flush();

    expect(screen.getByText(/polls close in 4h 00m/i)).toBeInTheDocument();
  });

  test('shows seconds in the final hour and counting once the doors close', async () => {
    vi.setSystemTime(new Date('2026-11-07T05:59:00Z'));
    mockConfig();

    renderLayout();
    await flush();
    expect(screen.getByText(/polls close in 00:01:00/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText(/polls closed/i)).toBeInTheDocument();
    expect(screen.getByText(/counting/i)).toBeInTheDocument();
  });

  test('follows the visitor clock, not a server clock that is wrong', async () => {
    // The server reports a clock ten hours slow (as a Fly machine in this
    // project did): the countdown must follow the device, or every visitor is
    // hours out on the one night it matters.
    vi.setSystemTime(new Date('2026-11-07T02:00:00Z'));
    mockConfig({ serverTime: '2026-11-06T16:00:00.000Z' });

    renderLayout();
    await flush();

    expect(screen.getByText(/polls close in 4h 00m/i)).toBeInTheDocument();
  });

  test('falls back to the date and time when no cycle is being served', async () => {
    vi.setSystemTime(new Date('2026-11-07T02:00:00Z'));
    mockConfig({ electionYear: null, pollsCloseAt: null });

    renderLayout();
    await flush();

    expect(screen.queryByText(/polls close/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nov/i)).toBeInTheDocument();
  });

  test('falls back to the date and time once a cycle is long past', async () => {
    // A 2026 replay run a week later: "polls closed · counting" would be a lie.
    vi.setSystemTime(new Date('2026-11-14T02:00:00Z'));
    mockConfig();

    renderLayout();
    await flush();

    expect(screen.queryByText(/polls close/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nov/i)).toBeInTheDocument();
  });

  test('still shows the clock when the config cannot be read', async () => {
    vi.setSystemTime(new Date('2026-11-07T02:00:00Z'));
    mockConfig({}, { fail: true });

    renderLayout();
    await flush();

    expect(screen.queryByText(/polls close/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nov/i)).toBeInTheDocument();
  });
});
