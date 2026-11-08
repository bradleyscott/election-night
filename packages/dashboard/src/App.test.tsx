// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { MockSocketProvider } from './test/test-utils.js';
import { mockResults } from './test/fixtures.js';

/** No runtime config in these tests: the masthead falls back to the clock. */
function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MockSocketProvider results={mockResults}>
          <App />
        </MockSocketProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('routes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('serves Close Calls on its own page', () => {
    renderAt('/close-calls');

    expect(
      screen.getByRole('heading', { name: 'Close Calls' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Seats' })
    ).not.toBeInTheDocument();
  });

  test('serves every candidate on their own page', () => {
    renderAt('/candidates');

    expect(
      screen.getByRole('heading', { name: 'Candidates' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Seats' })
    ).not.toBeInTheDocument();
  });
});
