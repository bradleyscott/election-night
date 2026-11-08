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
