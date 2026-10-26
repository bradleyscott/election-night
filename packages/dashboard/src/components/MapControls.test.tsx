// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { MapControls } from './MapControls.js';

const names = ['Banks Peninsula', 'Bay of Plenty'];

const renderControls = (
  props: Partial<Parameters<typeof MapControls>[0]> = {}
) =>
  render(
    <BrowserRouter>
      <MapControls
        names={names}
        showMaori={false}
        onShowMaoriChange={vi.fn()}
        {...props}
      />
    </BrowserRouter>
  );

describe('MapControls', () => {
  test('offers the seats the map is drawing and the General/Māori switch', () => {
    renderControls();

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Māori' })).toBeInTheDocument();
  });

  test('reports the switch rather than owning it', () => {
    const onShowMaoriChange = vi.fn();
    renderControls({ onShowMaoriChange });

    fireEvent.click(screen.getByRole('button', { name: 'Māori' }));
    expect(onShowMaoriChange).toHaveBeenCalledWith(true);
  });

  // Clear is a link back to the landing state, so it exists only while a seat
  // is open — the same condition the page header used to apply.
  test('shows no Clear until a seat is open', () => {
    const { rerender } = renderControls();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(
      <BrowserRouter>
        <MapControls
          names={names}
          showMaori={false}
          onShowMaoriChange={vi.fn()}
          showClear
        />
      </BrowserRouter>
    );

    // The word is hidden below `sm`; the link keeps a name at every width.
    const clear = screen.getByRole('link', { name: 'Clear seat selection' });
    expect(clear).toHaveAttribute('href', '/electorates');
  });
});
