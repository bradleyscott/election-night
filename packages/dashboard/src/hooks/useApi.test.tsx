// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useApi } from './useApi.js';

function TestComponent({ url }: { url: string | null }) {
  const { data, loading, error } = useApi<{ name: string }>(url);
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="error">{error ?? 'none'}</div>
      <div data-testid="data">{data ? data.name : 'no data'}</div>
    </div>
  );
}

describe('useApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('skips fetch when url is null', () => {
    render(<TestComponent url={null} />);
    expect(screen.getByTestId('loading')).toHaveTextContent('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('loads data on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'Auckland Central' }), { status: 200 })
    );

    render(<TestComponent url="/api/electorate" />);
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');

    await waitFor(() =>
      expect(screen.getByTestId('data')).toHaveTextContent('Auckland Central')
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('idle');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  test('sets error on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Not found', { status: 404 }));

    render(<TestComponent url="/api/missing" />);

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('HTTP 404')
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('idle');
    expect(screen.getByTestId('data')).toHaveTextContent('no data');
  });

  test('aborts previous fetch when url changes', async () => {
    const abort = vi.fn();
    const controllers: AbortController[] = [];
    vi.mocked(fetch).mockImplementation((url, init) => {
      const controller = new AbortController();
      controllers.push(controller);
      // Link the global AbortSignal to our controller so we can observe abort.
      if (init && typeof init === 'object' && 'signal' in init && init.signal) {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          abort(signal.reason);
          controller.abort();
        });
      }
      return new Promise<Response>(() => {
        // Never resolves.
      });
    });

    const { rerender } = render(<TestComponent url="/api/one" />);
    rerender(<TestComponent url="/api/two" />);

    await waitFor(() => expect(controllers.length).toBeGreaterThanOrEqual(1));
    // The first request should be aborted when the URL changes.
    controllers[0].abort();
    await waitFor(() => expect(abort).toHaveBeenCalled());
  });
});
