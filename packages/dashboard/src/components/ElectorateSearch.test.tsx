// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type * as ReactRouter from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { ElectorateSearch } from './ElectorateSearch.js';

const names = ['Auckland Central', 'Banks Peninsula', 'Bay of Plenty'];

const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...actual, useNavigate: () => mockedNavigate };
});

describe('ElectorateSearch', () => {
  beforeEach(() => {
    mockedNavigate.mockReset();
  });

  test('renders a combobox with a hidden label', () => {
    render(
      <BrowserRouter>
        <ElectorateSearch names={names} />
      </BrowserRouter>
    );

    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Search electorate')).toBeInTheDocument();
  });

  test('opens listbox and navigates with keyboard', async () => {
    render(
      <BrowserRouter>
        <ElectorateSearch names={names} />
      </BrowserRouter>
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'auck' } });

    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Auckland Central');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockedNavigate).toHaveBeenCalledWith('/electorates/Auckland%20Central');
  });

  test('closes listbox on Escape', async () => {
    render(
      <BrowserRouter>
        <ElectorateSearch names={names} />
      </BrowserRouter>
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});
