// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Seats from './Seats.js';
import { MockSocketProvider } from '../test/test-utils.js';
import { mockResults } from '../test/fixtures.js';

describe('Seats page', () => {
  test('renders seat totals when results are available', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider results={mockResults} connected>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Total Seats')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.getByText('Parties in Parliament')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('renders waiting state when no results are available', () => {
    render(
      <BrowserRouter>
        <MockSocketProvider results={null} connected={false}>
          <Seats />
        </MockSocketProvider>
      </BrowserRouter>
    );

    expect(screen.getByText('Awaiting First Results')).toBeInTheDocument();
  });
});
