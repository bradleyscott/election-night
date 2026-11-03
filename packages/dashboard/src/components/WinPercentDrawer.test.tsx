// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WinPercentProvider } from './WinPercentDrawer.js';
import { WinPercentLink } from './WinPercentLink.js';

function renderHarness() {
  return render(
    <WinPercentProvider>
      <WinPercentLink />
    </WinPercentProvider>
  );
}

describe('WinPercentDrawer', () => {
  test('puts the header in the same case as the table headings beside it', () => {
    renderHarness();

    // Preflight removes text-transform from buttons, so the label has to
    // restate `uppercase` or it reads "Win %" beside "LEAD" and "SECOND".
    expect(
      screen.getByRole('button', { name: /how we work out win %/i })
    ).toHaveClass('uppercase');
  });

  test('is closed until the header is asked', () => {
    renderHarness();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /how we work out win %/i })
    ).toBeInTheDocument();
  });

  test('marks every figure as an example, rather than saying it once at the top', () => {
    renderHarness();
    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );

    const dialog = screen.getByRole('dialog');
    // Six steps, six drawings, each carrying its own chip.
    expect(screen.getAllByText(/^example$/i)).toHaveLength(6);
    expect(dialog).not.toHaveTextContent(/not tonight's results/i);
    expect(dialog).not.toHaveTextContent(/round numbers/i);
  });

  test('puts each figure directly under its heading, before the prose', () => {
    renderHarness();
    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );

    // On a phone the drawing is the shortest statement of the step, so it comes
    // straight after the heading; the prose underneath explains it.
    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'How many votes are left',
    });
    const figure = heading.nextElementSibling;
    expect(figure).toHaveTextContent(/^example/i);
    expect(figure).not.toHaveTextContent(/Electoral Commission/);
    expect(figure?.nextElementSibling).toHaveTextContent(
      /Electoral Commission/
    );
  });

  test('walks the method: what goes in, then how it becomes a number', () => {
    renderHarness();
    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );

    for (const title of [
      'How many votes are left',
      'Who the remaining votes will favour',
      'The expected result',
      'How far it could still move',
      'Turning the spread into Win %',
      'Adding the special votes',
    ]) {
      expect(
        screen.getByRole('heading', { level: 3, name: title })
      ).toBeInTheDocument();
    }
  });

  test('pins the worked example and the claim behind the prior', () => {
    renderHarness();
    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );
    const text = screen.getByRole('dialog').textContent ?? '';

    // The arithmetic a reader can redo: 12 − 10 = 2, and 393 ÷ 9,700 ≈ 4.
    expect(text).toContain('National won by 12 last time');
    expect(text).toContain('four points more than the election-night count');
    expect(text).toContain('54% of it is on National');
    expect(text).toContain('66 cases out of 100');
    // The measured basis for the ten-point prior, not an assertion.
    expect(text).toContain('three times the swing a typical seat showed');
    // The footer that named the model file was removed on review.
    expect(text).not.toContain('seat-probability.ts');
  });

  test('closes on Escape, and gives focus back to the header', () => {
    renderHarness();
    const trigger = screen.getByRole('button', {
      name: /how we work out win %/i,
    });

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(trigger).toHaveFocus();
  });

  test('closes on its own close button', () => {
    renderHarness();
    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );
    fireEvent.click(
      screen.getByRole('button', { name: /close the explainer/i })
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('carries no em-dashes', () => {
    renderHarness();
    fireEvent.click(
      screen.getByRole('button', { name: /how we work out win %/i })
    );

    // U+2212 in the diagram ("swing −10") is a minus sign, not an em-dash.
    expect(screen.getByRole('dialog').textContent).not.toContain('—');
  });
});
