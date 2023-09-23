import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'fs';
import { getCandidateResults, getPartyResults } from './scraper';
import { html } from './fixtures';

vi.mock('./candidates.js', () => {
  const candidatesCsv = () => readFileSync('csv/candidates_test.csv');
  return { candidatesCsv };
});

describe('scraper', () => {
  test('parseCandidateResults', () => {
    const expected = [
      {
        candidate: 'DELAMERE, Tuariki',
        votes: 320,
        party: undefined,
      },
      {
        candidate: 'HOFFMAN DERVAN, Dominic',
        votes: 50,
        party: undefined,
      },
      {
        candidate: 'LOVE, Joshua',
        votes: 73,
        party: undefined,
      },
      {
        candidate: 'MARCROFT, Jenny',
        votes: 274,
        party: undefined,
      },
      {
        candidate: 'MELLOW, Emma',
        votes: 9775,
        party: undefined,
      },
      {
        candidate: 'POOLE, Felix',
        votes: 588,
        party: undefined,
      },
      {
        candidate: 'SADLER, Chris',
        votes: 23,
        party: undefined,
      },
      {
        candidate: 'STITT, Kevin',
        votes: 186,
        party: undefined,
      },
      {
        candidate: 'SWARBRICK, Chlöe',
        votes: 12631,
        party: 'Green Party',
      },
      {
        candidate: 'TAVA, Vernon',
        votes: 120,
        party: undefined,
      },
      {
        candidate: 'WHITE, Helen',
        votes: 11563,
        party: undefined,
      },
    ];
    const actual = getCandidateResults(html);
    expect(actual).toEqual(expected);
  });

  test('parsePartyResults', () => {
    const expected = [
      {
        candidate: 'The Opportunities Party (TOP)',
        votes: 776,
      },
      {
        candidate: 'TEA Party',
        votes: 35,
      },
      {
        candidate: 'New Zealand First Party',
        votes: 622,
      },
      {
        candidate: 'National Party',
        votes: 7680,
      },
      {
        candidate: 'ACT New Zealand',
        votes: 2724,
      },
      {
        candidate: 'New Conservative',
        votes: 197,
      },
      {
        candidate: 'Green Party',
        votes: 6937,
      },
      {
        candidate: 'Sustainable New Zealand Party',
        votes: 59,
      },
      {
        candidate: 'Labour Party',
        votes: 16751,
      },
      {
        candidate: 'Advance NZ',
        votes: 198,
      },
      {
        candidate: 'Aotearoa Legalise Cannabis Party',
        votes: 99,
      },
      {
        candidate: 'HeartlandNZ',
        votes: 1,
      },
      {
        candidate: 'Māori Party',
        votes: 111,
      },
      {
        candidate: 'NZ Outdoors Party',
        votes: 15,
      },
      {
        candidate: 'ONE Party',
        votes: 20,
      },
      {
        candidate: 'Social Credit',
        votes: 7,
      },
      {
        candidate: 'Vision New Zealand',
        votes: 11,
      },
    ];
    const actual = getPartyResults(html);
    expect(actual).toEqual(expected);
  });
});
