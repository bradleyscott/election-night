// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BottomSheet from './BottomSheet.js';

describe('BottomSheet', () => {
  test('renders dialog with accessibility attributes when open', () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Seat details">
        <p>Content</p>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');

    const title = screen.getByText('Seat details');
    expect(title.id).toBe(dialog.getAttribute('aria-labelledby'));
  });

  test('does not render when closed', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
