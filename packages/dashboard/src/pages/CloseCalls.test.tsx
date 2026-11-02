// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CloseCalls from './CloseCalls.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { WinPercentProvider } from '../components/WinPercentDrawer.js';
import { mockResults } from '../test/fixtures.js';
import type { ResultsPayload } from '@election-night/core/types';

function renderCloseCalls(results: ResultsPayload | null = mockResults) {
  return render(
    <MemoryRouter initialEntries={['/close-calls']}>
      <MockSocketProvider results={results}>
        <WinPercentProvider>
          <CloseCalls />
        </WinPercentProvider>
      </MockSocketProvider>
    </MemoryRouter>
  );
}

describe('Close Calls page', () => {
  test('renders the head and both views', () => {
    renderCloseCalls();

    expect(
      screen.getByRole('heading', { name: 'Close Calls' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Electorate Races' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'List Cut Lines' })
    ).toBeInTheDocument();
    // The page opens on List Cut Lines.
    expect(
      screen.getByRole('button', { name: 'List Cut Lines' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Electorate Races' })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('shows a close call a chance of winning, not a margin and its error', () => {
    renderCloseCalls();

    fireEvent.click(screen.getByRole('button', { name: 'Electorate Races' }));

    // The fixture has no prior on file, so the chance is capped at 95% rather
    // than claimed as a certainty — and the special vote now sits inside the
    // number, so it lands below the cap. What matters is that the column states
    // a chance at all: the ± margin-of-error suffix is gone from the table.
    expect(screen.getAllByText(/^\d+%$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText(/±/)).toBeNull();
  });

  test('renders waiting state when no results are available', () => {
    renderCloseCalls(null);

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });
});
