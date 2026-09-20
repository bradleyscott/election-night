import { describe, test, expect } from 'vitest';
import { normalizeElectorateName } from './electorate-names.js';
import {
  ELECTORATE_RENAMES,
  resolvePriorElectorateName,
  successionChain,
} from './electorate-successions.js';

describe('successionChain', () => {
  test('walks every cycle between two elections', () => {
    expect(successionChain('2017', '2026')).toEqual([
      '2017',
      '2020',
      '2023',
      '2026',
    ]);
    expect(successionChain('2020', '2023')).toEqual(['2020', '2023']);
    expect(successionChain('2023', '2026')).toEqual(['2023', '2026']);
  });

  test('is empty for the same year or a reversed range', () => {
    expect(successionChain('2026', '2026')).toEqual([]);
    expect(successionChain('2026', '2023')).toEqual([]);
  });
});

describe('resolvePriorElectorateName', () => {
  test('applies the rename for a single step', () => {
    expect(resolvePriorElectorateName('2023', '2026', 'Bay of Plenty')).toBe(
      'Mt Maunganui'
    );
    expect(resolvePriorElectorateName('2017', '2020', 'Rimutaka')).toBe(
      'Remutaka'
    );
  });

  test('composes renames across multiple steps', () => {
    // Manukau East → Panmure-Ōtāhuhu (2020) → Ōtāhuhu (2026)
    expect(resolvePriorElectorateName('2017', '2026', 'Manukau East')).toBe(
      'Ōtāhuhu'
    );
    expect(resolvePriorElectorateName('2017', '2026', 'Clutha-Southland')).toBe(
      'Southland'
    );
    expect(resolvePriorElectorateName('2017', '2026', 'Dunedin North')).toBe(
      'Dunedin'
    );
  });

  test('needs no entry for a spelling-only change', () => {
    const resolved = resolvePriorElectorateName('2017', '2020', 'Whangarei');
    expect(resolved).toBe('Whangarei');
    expect(normalizeElectorateName(resolved)).toBe(
      normalizeElectorateName('Whangārei')
    );
  });

  test('leaves a merged-away seat unresolved so the caller drops it', () => {
    // Ōtaki, Mana and Ōhāriu were merged into Kapiti and Kenepuru. Returning
    // the name unchanged is what makes the comparison disappear: no 2026
    // electorate carries it, so the seat has no prior holder.
    expect(resolvePriorElectorateName('2023', '2026', 'Ōtaki')).toBe('Ōtaki');
    expect(resolvePriorElectorateName('2023', '2026', 'Kelston')).toBe(
      'Kelston'
    );
  });

  test('carries the seven Māori electorates through every cycle', () => {
    const maori = ['Hauraki-Waikato', 'Ikaroa-Rāwhiti', 'Waiariki'];
    for (const name of maori) {
      expect(resolvePriorElectorateName('2017', '2026', name)).toBe(name);
    }
  });

  test('is a no-op when no chain exists', () => {
    expect(resolvePriorElectorateName('2026', '2026', 'Ōtāhuhu')).toBe(
      'Ōtāhuhu'
    );
  });
});

describe('rename data', () => {
  test('every step maps a name to a different name exactly once', () => {
    for (const [year, renames] of Object.entries(ELECTORATE_RENAMES)) {
      const froms = new Set<string>();
      for (const { from, to, source } of renames) {
        expect(source, `${year}: ${from} needs a source`).toBeTruthy();
        expect(
          normalizeElectorateName(from),
          `${year}: ${from} renames to itself`
        ).not.toBe(normalizeElectorateName(to));
        const key = normalizeElectorateName(from);
        expect(froms.has(key), `${year}: ${from} listed twice`).toBe(false);
        froms.add(key);
      }
    }
  });
});
