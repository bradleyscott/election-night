import { describe, expect, test } from 'vitest';
import {
  PARTY_FILTER_NAMES,
  PARTY_RENAMES,
  canonicalPartyName,
  partyColor,
  partyColors,
} from './constants.js';

describe('party names', () => {
  test('the filter row lists each party once', () => {
    expect(PARTY_FILTER_NAMES.length).toBe(new Set(PARTY_FILTER_NAMES).size);
    expect(
      PARTY_FILTER_NAMES.filter((name) => name === 'Opportunity Party')
    ).toHaveLength(1);
  });

  test('a renamed party collapses onto its registered name', () => {
    expect(canonicalPartyName('The Opportunities Party (TOP)')).toBe(
      'Opportunity Party'
    );
    expect(canonicalPartyName('Opportunity Party')).toBe('Opportunity Party');
    expect(canonicalPartyName('Labour Party')).toBe('Labour Party');
  });

  test('every filter entry has a colour under its current name', () => {
    for (const name of PARTY_FILTER_NAMES) {
      expect(partyColors[name]).toBeDefined();
    }
  });

  test('both spellings resolve to the same colour', () => {
    expect(partyColor('The Opportunities Party (TOP)')).toBe(
      partyColor('Opportunity Party')
    );
  });

  test('a rename keeps both names in the palette so an archive still draws', () => {
    for (const [from, to] of Object.entries(PARTY_RENAMES)) {
      expect(partyColors[from]).toBeDefined();
      expect(partyColors[to]).toBeDefined();
      expect(partyColors[from]).toBe(partyColors[to]);
    }
  });
});
