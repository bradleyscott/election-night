import { describe, expect, test } from 'vitest';
import {
  MAJOR_PARTY_ORDER,
  PARTY_FILTER_NAMES,
  PARTY_RENAMES,
  canonicalPartyName,
  isMajorParty,
  orderParties,
  partyColor,
  partyColors,
  splitParties,
} from './constants.js';

/**
 * Party 24 is published as "The Opportunities Party (TOP)" (abbrev TOP) in the
 * 2023 archive and as "Opportunity Party" (abbrev OPP) in the live 2026 feed.
 * Both must resolve to the same colour, chip and position.
 */
const TOP_2023 = 'The Opportunities Party (TOP)';
const TOP_2026 = 'Opportunity Party';

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

describe('party identity across cycles', () => {
  test('the 2026 feed label resolves to the 2023 colour', () => {
    expect(partyColor(TOP_2026)).toBe(partyColors[TOP_2023]);
    expect(partyColor(TOP_2026)).not.toBe('#666');
    expect(partyColor(TOP_2023)).toBe(partyColor(TOP_2026));
  });

  test('unknown, empty and missing parties take the fallback colour', () => {
    expect(partyColor('Advance NZ')).toBe('#666');
    expect(partyColor('')).toBe('#666');
    expect(partyColor(null)).toBe('#666');
    expect(partyColor(undefined)).toBe('#666');
    expect(partyColor(null, '#9ca3af')).toBe('#9ca3af');
    expect(partyColor(TOP_2026, '#9ca3af')).not.toBe('#9ca3af');
  });

  test('every rename maps a different name onto a coloured party', () => {
    const renames = Object.entries(PARTY_RENAMES);
    expect(renames.length).toBeGreaterThan(0);
    for (const [from, to] of renames) {
      expect(from).not.toBe(to);
      expect(partyColors[to]).toBeTruthy();
    }
  });

  test('every chipped party has a colour', () => {
    for (const party of MAJOR_PARTY_ORDER) {
      expect(partyColors[party]).toBeTruthy();
    }
  });
});

describe('party chip lists', () => {
  test('the renamed party is a chip, not hidden behind "More…"', () => {
    const { major, other } = splitParties([
      TOP_2026,
      'Advance NZ',
      'National Party',
    ]);
    expect(major).toEqual(['National Party', TOP_2026]);
    expect(other).toEqual(['Advance NZ']);
  });

  test('both feed labels chip wherever the payload carries them', () => {
    expect(splitParties([TOP_2023]).major).toEqual([TOP_2023]);
    expect(splitParties([TOP_2026]).major).toEqual([TOP_2026]);
    expect(isMajorParty(TOP_2023)).toBe(true);
    expect(isMajorParty(TOP_2026)).toBe(true);
    expect(isMajorParty('Advance NZ')).toBe(false);
  });

  test('chips follow the fixed editorial order regardless of payload order', () => {
    const { major } = splitParties([
      TOP_2026,
      'Green Party',
      'ACT New Zealand',
      'National Party',
      'Labour Party',
      'New Zealand First Party',
    ]);
    expect(major).toEqual([
      'National Party',
      'Labour Party',
      'Green Party',
      'ACT New Zealand',
      'New Zealand First Party',
      TOP_2026,
    ]);
  });

  test('TOP sits after the five established parties', () => {
    expect(MAJOR_PARTY_ORDER.indexOf(TOP_2026)).toBe(
      MAJOR_PARTY_ORDER.length - 1
    );
  });

  test('unlisted parties keep arrival order after the chipped ones', () => {
    expect(
      orderParties([
        'Advance NZ',
        'Labour Party',
        'Vision New Zealand',
        'National Party',
      ])
    ).toEqual([
      'National Party',
      'Labour Party',
      'Advance NZ',
      'Vision New Zealand',
    ]);
  });
});

describe('party palette', () => {
  test('TOP carries the party’s own teal, not the old indigo', () => {
    // The registered "Opportunity Logo (RGB teal)" artwork fills every path with
    // this value. The dashboard originally shipped an unrelated indigo, which
    // is the one thing a viewer of a party in contention would notice first.
    expect(partyColors[TOP_2023]).toBe('#00B9BC');
    expect(partyColor(TOP_2026)).toBe('#00B9BC');
  });

  test('no two chipped parties share a colour', () => {
    const colours = MAJOR_PARTY_ORDER.map((party) => partyColor(party));
    expect(new Set(colours).size).toBe(colours.length);
  });
});
