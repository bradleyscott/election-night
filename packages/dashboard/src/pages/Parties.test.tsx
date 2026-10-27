// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Parties from './Parties.js';
import { mockResults } from '../test/fixtures.js';
import { renderWithProvidersAndData } from '../test/test-utils.js';
import type {
  ResultsPayload,
  PartyListResult,
} from '@election-night/core/types';

function listEntry(party: string, candidate: string): PartyListResult {
  return {
    party,
    candidate,
    listRank: 1,
    adjustedRank: 1,
    distanceFromCut: -2,
  };
}

/** Results as the live 2026 feed labels party 24 ("Opportunity Party"). */
const results2026: ResultsPayload = {
  ...mockResults,
  partyLists: [
    ...(mockResults.partyLists ?? []),
    listEntry('Opportunity Party', 'LEE, Emma'),
  ],
};

/** Results as the 2023 archive labels the same party. */
const results2023: ResultsPayload = {
  ...mockResults,
  partyLists: [
    ...(mockResults.partyLists ?? []),
    listEntry('The Opportunities Party (TOP)', 'LEE, Emma'),
  ],
};

describe('Parties page party filter', () => {
  test('chips TOP in the party\u2019s own teal', () => {
    render(renderWithProvidersAndData(<Parties />, { results: results2026 }));
    const chip = screen.getByRole('button', { name: /Opportunity Party/ });
    const dot = chip.querySelector('span');
    // #00B9BC from TOP's registered logo, rendered through partyColor.
    expect(dot?.style.backgroundColor).toMatch(/0,\s*185,\s*188/);
  });

  test('chips the 2026 label for the Opportunities Party', () => {
    render(renderWithProvidersAndData(<Parties />, { results: results2026 }));

    expect(
      screen.getByRole('button', { name: /Opportunity Party/ })
    ).toBeInTheDocument();
    // Only major parties are present, so nothing spills into the "More…" list.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('chips the 2023 label for the same party', () => {
    render(renderWithProvidersAndData(<Parties />, { results: results2023 }));

    expect(
      screen.getByRole('button', { name: /The Opportunities Party \(TOP\)/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('selecting the chip shows that party list', () => {
    render(renderWithProvidersAndData(<Parties />, { results: results2026 }));

    expect(screen.queryByText('LEE, Emma')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Opportunity Party/ }));
    expect(screen.getByText('LEE, Emma')).toBeInTheDocument();
  });

  test('a party outside the fixed order still lands in the More… select', () => {
    const results = {
      ...mockResults,
      partyLists: [
        ...(mockResults.partyLists ?? []),
        listEntry('Opportunity Party', 'LEE, Emma'),
        listEntry('Advance NZ', 'DOE, Jane'),
      ],
    } as ResultsPayload;

    render(renderWithProvidersAndData(<Parties />, { results }));

    expect(
      screen.getByRole('button', { name: /Opportunity Party/ })
    ).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent
    );
    expect(options).toContain('Advance NZ');
    expect(options).not.toContain('Opportunity Party');
  });
});
