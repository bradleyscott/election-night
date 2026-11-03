// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ElectorateMap, { MAP_HEIGHT } from './ElectorateMap.js';

beforeEach(() => {
  // The map fetches its boundary manifest and GeoJSON on mount; the placeholder
  // is what renders before (and after a failure), which is all this pins.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline')))
  );
});

test('caps the map at a share of the visible viewport', () => {
  // A fixed 600px height filled a laptop window and a phone in landscape. Both
  // steps are a percentage of `svh` (the viewport with the browser's chrome
  // showing), so the map can never be as tall as the screen, with a pixel
  // ceiling so it does not balloon on a tall monitor.
  expect(MAP_HEIGHT).toBe('h-[min(380px,55svh)] sm:h-[min(600px,62svh)]');
  for (const variant of MAP_HEIGHT.split(' ')) {
    // Every step is bounded by the viewport, never a bare pixel height.
    expect(variant).toContain('svh');
  }
});

test('renders the placeholder at the same height as the map', () => {
  const { container } = render(
    <MemoryRouter>
      <ElectorateMap electorates={[]} showMaori={false} />
    </MemoryRouter>
  );

  // The loading card and the map use one constant, so nothing jumps when the
  // boundaries arrive.
  const placeholder = container.firstElementChild;
  for (const cls of MAP_HEIGHT.split(' ')) {
    expect(placeholder).toHaveClass(cls);
  }
});
