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

  // Clearing is what the nav entry, the back button and picking another seat
  // do; there is no Clear control in either state.
  test('offers no Clear control, with or without a seat open', () => {
    const { rerender } = renderControls();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(
      <BrowserRouter>
        <MapControls
          names={names}
          showMaori={false}
          onShowMaoriChange={vi.fn()}
          selectedName="Ōtāhuhu"
        />
      </BrowserRouter>
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  // With a seat open the controls leave the card's flow and float over the map,
  // so the map starts at the top of the card.
  test('floats over the map once a seat is open', () => {
    const { container, rerender } = renderControls();
    expect(container.firstChild).not.toHaveClass('absolute');

    rerender(
      <BrowserRouter>
        <MapControls
          names={names}
          showMaori={false}
          onShowMaoriChange={vi.fn()}
          selectedName="Ōtāhuhu"
        />
      </BrowserRouter>
    );

    expect(container.firstChild).toHaveClass('absolute');
  });

  // With a seat open the field and the roll switch are folded away: the map is
  // what the reader came for. One click brings them back.
  test('folds the search and the switch behind a button while a seat is open', () => {
    renderControls({ selectedName: 'Ōtāhuhu' });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Māori' })
    ).not.toBeInTheDocument();

    const search = screen.getByRole('button', { name: 'Search electorates' });
    expect(search).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(search);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Māori' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide electorate search' })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  test('folds away again when the open seat changes', () => {
    const { rerender } = renderControls({ selectedName: 'Ōtāhuhu' });
    fireEvent.click(screen.getByRole('button', { name: 'Search electorates' }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    rerender(
      <BrowserRouter>
        <MapControls
          names={names}
          showMaori={false}
          onShowMaoriChange={vi.fn()}
          selectedName="Kapiti"
        />
      </BrowserRouter>
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Search electorates' })
    ).toBeInTheDocument();
  });
});
