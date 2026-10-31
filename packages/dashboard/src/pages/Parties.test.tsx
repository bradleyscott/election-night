// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Parties from './Parties.js';
import { mockResults, mockElectorateResult } from '../test/fixtures.js';
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

/**
 * The cut is drawn where the "From cut" column crosses zero. An electorate
 * winner prints no distance at all (they are in Parliament either way), so the
 * line has to count them as above it rather than fall inside the winners' block
 * that "Show electorate leaders" sorts to the top.
 */
describe('Parties page cut line', () => {
  const candidates = [
    'SMITH, John',
    'TAYLOR, Alex',
    'BROWN, Sam',
    'WHITE, Sue',
    'GREEN, Kim',
    'BLACK, Lee',
  ];

  const results: ResultsPayload = {
    ...mockResults,
    electorateResults: [
      mockElectorateResult,
      {
        ...mockElectorateResult,
        electorateName: 'Wellington Central',
        leaders: {
          ...mockElectorateResult.leaders,
          leadingCandidate: 'TAYLOR, Alex',
          leadingCandidateParty: 'National Party',
        },
      },
    ],
    partyLists: [
      // Two electorate winners, both below the list cut on paper.
      {
        party: 'National Party',
        candidate: 'SMITH, John',
        listRank: 3,
        adjustedRank: 3,
        distanceFromCut: -1,
      },
      {
        party: 'National Party',
        candidate: 'TAYLOR, Alex',
        listRank: 9,
        adjustedRank: 9,
        distanceFromCut: -7,
      },
      // List-elected: +1 and +0. Then the first candidates below the cut.
      {
        party: 'National Party',
        candidate: 'BROWN, Sam',
        listRank: 1,
        adjustedRank: 1,
        distanceFromCut: 1,
      },
      {
        party: 'National Party',
        candidate: 'WHITE, Sue',
        listRank: 2,
        adjustedRank: 2,
        distanceFromCut: 0,
      },
      {
        party: 'National Party',
        candidate: 'GREEN, Kim',
        listRank: 6,
        adjustedRank: 6,
        distanceFromCut: -4,
      },
      {
        party: 'National Party',
        candidate: 'BLACK, Lee',
        listRank: 10,
        adjustedRank: 10,
        distanceFromCut: -8,
      },
    ],
  };

  /** Row order, with the cut standing in for itself. */
  function renderedRows(): string[] {
    return Array.from(document.querySelectorAll('tbody tr')).map((row) => {
      const text = row.textContent ?? '';
      if (text.includes('Cut')) return 'CUT';
      return candidates.find((name) => text.includes(name)) ?? '?';
    });
  }

  test('sits between +0 and the first negative distance', () => {
    render(renderWithProvidersAndData(<Parties />, { results }));

    expect(renderedRows()).toEqual([
      'BROWN, Sam',
      'WHITE, Sue',
      'CUT',
      'GREEN, Kim',
      'BLACK, Lee',
    ]);
  });

  test('follows the electorate winners when they are shown', () => {
    render(renderWithProvidersAndData(<Parties />, { results }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Show electorate leaders/ })
    );

    // Both winners are elected by right, so neither may fall below the line.
    expect(renderedRows()).toEqual([
      'SMITH, John',
      'TAYLOR, Alex',
      'BROWN, Sam',
      'WHITE, Sue',
      'CUT',
      'GREEN, Kim',
      'BLACK, Lee',
    ]);
  });
});
