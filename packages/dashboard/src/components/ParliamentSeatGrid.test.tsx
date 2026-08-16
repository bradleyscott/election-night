// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParliamentSeatGrid } from './ParliamentSeatGrid.js';
import type { SeatInfo } from '../lib/parliament.js';

const seats: SeatInfo[] = [
  { party: 'National Party', color: '#00529F', opacity: 1, type: 'electorate', name: 'Auckland Central' },
  { party: 'Labour Party', color: '#D82A20', opacity: 1, type: 'electorate', name: 'Mt Albert' },
  { party: 'Vacant', color: '#888888', opacity: 0.5, type: 'list', name: '' },
];

const noop = () => {};

describe('ParliamentSeatGrid', () => {
  test('seats are focusable and support keyboard drag', () => {
    const onDragStart = vi.fn();
    const onDrop = vi.fn();
    const onDragEnd = vi.fn();

    render(
      <ParliamentSeatGrid
        seats={seats}
        draggingParty={null}
        dropTargetParty={null}
        hoveredParty={null}
        selectedSeat={null}
        onDragStart={onDragStart}
        onDragEnter={noop}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        onHover={noop}
        onSelect={noop}
      />
    );

    const nationalSeat = screen.getByLabelText('National Party electorate seat');
    expect(nationalSeat).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(nationalSeat, { key: ' ' });
    expect(onDragStart).toHaveBeenCalledWith('National Party');

    fireEvent.keyDown(nationalSeat, { key: 'ArrowDown' });
    fireEvent.keyDown(nationalSeat, { key: 'Enter' });
    expect(onDrop).toHaveBeenCalledWith('National Party', 'Labour Party');
    expect(onDragEnd).toHaveBeenCalled();
  });

  test('vacant seats are not focusable', () => {
    render(
      <ParliamentSeatGrid
        seats={seats}
        draggingParty={null}
        dropTargetParty={null}
        hoveredParty={null}
        selectedSeat={null}
        onDragStart={noop}
        onDragEnter={noop}
        onDragEnd={noop}
        onDrop={noop}
        onHover={noop}
        onSelect={noop}
      />
    );

    const vacantSeat = screen.getByLabelText('Vacant list seat');
    expect(vacantSeat).toHaveAttribute('tabIndex', '-1');
  });
});
