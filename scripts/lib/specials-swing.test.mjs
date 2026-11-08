import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION,
  decodeParsedCache,
  encodeParsedCache,
  isSummaryHeader,
  measure,
  parsePage,
} from './specials-swing.mjs';

/** An electorate page with the given header and data cells. */
function page(headers, dataRows, title = 'Test Candidate Vote Details') {
  const head = [title, ...headers].map((cell) => `<th>${cell}</th>`).join('');
  const body = dataRows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  return `<table><tr>${head}</tr>${body}</table>`;
}

const REQUIRED_HEADERS = [
  'A',
  'B',
  'Total Valid Candidate Votes',
  'Informal Candidate Votes',
];
const REQUIRED_ROWS = [
  ['Special Votes', '100', '90', '190', '0'],
  ['Total', '1000', '900', '1900', '0'],
];

describe('specials parser', () => {
  it('reads the required fixture without letting summary columns in', () => {
    const parsed = parsePage(page(REQUIRED_HEADERS, REQUIRED_ROWS));

    expect(parsed.electorate).toBe('Test');
    expect(parsed.candidates).toEqual(['A', 'B']);
    expect(Object.keys(parsed.total)).toEqual(['A', 'B']);
    expect(Object.keys(parsed.special)).toEqual(['A', 'B']);
    expect(parsed.total).toEqual({ A: 1000, B: 900 });
    expect(parsed.special).toEqual({ A: 100, B: 90 });

    // The measured totals are the candidates' totals, not the page totals
    // doubled by the summary columns.
    const total = Object.values(parsed.total).reduce((a, b) => a + b, 0);
    const special = Object.values(parsed.special).reduce((a, b) => a + b, 0);
    expect(total).toBe(1900);
    expect(special).toBe(190);

    const ordinary = {
      A: parsed.total.A - parsed.special.A,
      B: parsed.total.B - parsed.special.B,
    };
    expect(ordinary).toEqual({ A: 900, B: 810 });
  });

  it('keeps alignment when a summary column is not last', () => {
    // The old parser filtered the header but sliced the first N data cells, so
    // B took the summary column's 1900 and the specials doubled.
    const parsed = parsePage(
      page(
        ['A', 'Total Valid Candidate Votes', 'B', 'Informal Candidate Votes'],
        [
          ['Special Votes', '100', '190', '90', '0'],
          ['Total', '1000', '1900', '900', '0'],
        ]
      )
    );

    expect(parsed.candidates).toEqual(['A', 'B']);
    expect(parsed.total).toEqual({ A: 1000, B: 900 });
    expect(parsed.special).toEqual({ A: 100, B: 90 });

    const [result] = measure({ Test: parsed });
    expect(result.winner).toBe('A');
    expect(result.runnerUp).toBe('B');
    expect(result.specialVotes).toBe(190);
    expect(result.finalMargin).toBe(100);
    // Ordinary A=900, B=810: the count margin is 90, not the final 100.
    expect(result.countMargin).toBe(90);
  });

  it('normalises the header shapes of 2017, 2020 and 2023', () => {
    const shapes = [
      // 2017 spelling
      ['Total Valid Candidate Votes', 'Informal Candidate Votes'],
      // 2020 upper case
      ['TOTAL VALID CANDIDATE VOTES', 'INFORMAL CANDIDATE VOTES'],
      // 2023 spacing and the shorter labels
      ['Total  Valid  Votes', 'Informal  Votes'],
    ];

    for (const [valid, informal] of shapes) {
      const parsed = parsePage(
        page(['A', 'B', valid, informal], REQUIRED_ROWS)
      );
      expect(parsed.candidates).toEqual(['A', 'B']);
      expect(parsed.total).toEqual({ A: 1000, B: 900 });
      expect(parsed.special).toEqual({ A: 100, B: 90 });
    }
  });

  it('recognises punctuation and case variants as summary headers', () => {
    expect(isSummaryHeader('Total Valid Candidate Votes')).toBe(true);
    expect(isSummaryHeader('total-valid-candidate-votes')).toBe(true);
    expect(isSummaryHeader('Informal Candidate Votes')).toBe(true);
    expect(isSummaryHeader('INFORMAL VOTES')).toBe(true);
    expect(isSummaryHeader('SMITH, John')).toBe(false);
    expect(isSummaryHeader('')).toBe(true);
  });

  it('sums the three special rows and ignores an aggregate one', () => {
    const parsed = parsePage(
      page(
        ['A', 'B', 'Total Valid Candidate Votes'],
        [
          ['Special Votes (Overseas)', '10', '5', '15'],
          ['Special Votes Before Polling Day', '20', '10', '30'],
          ['Special Votes On Polling Day', '30', '20', '50'],
          ['Special Votes Total', '60', '35', '95'],
          ['Total', '100', '90', '190'],
        ]
      )
    );

    expect(parsed.special).toEqual({ A: 60, B: 35 });
  });

  it('measures a non-zero swing when the pools differ', () => {
    const parsed = parsePage(
      page(
        ['A', 'B', 'Total Valid Candidate Votes'],
        [
          ['Special Votes', '150', '50', '200'],
          ['Total', '1000', '900', '1900'],
        ]
      )
    );

    const [result] = measure({ Test: parsed });
    // Specials 150/50 (50 points) against an ordinary pool of 850/850 (0).
    expect(result.swing).toBe(50);
  });
});

describe('parsed cache versioning', () => {
  const seats = {
    Test: {
      source: 'https://example.test/page',
      candidates: ['A', 'B'],
      special: { A: 100, B: 90 },
      total: { A: 1000, B: 900 },
    },
  };

  it('round-trips a versioned cache with provenance', () => {
    const raw = encodeParsedCache({
      year: '2023',
      seats,
      sources: [{ page: 1, url: 'https://example.test/page' }],
    });
    const parsed = JSON.parse(raw);

    expect(parsed.version).toBe(CACHE_VERSION);
    expect(parsed.year).toBe('2023');
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.generatedAt).toEqual(expect.any(String));
    expect(decodeParsedCache(raw, '2023')).toEqual(seats);
  });

  it('refuses the legacy bare-seats shape', () => {
    expect(decodeParsedCache(JSON.stringify(seats), '2023')).toBeNull();
  });

  it('refuses another version or cycle', () => {
    const raw = encodeParsedCache({ year: '2023', seats, sources: [] });
    expect(decodeParsedCache(raw, '2020')).toBeNull();

    const old = JSON.parse(raw);
    old.version = CACHE_VERSION - 1;
    expect(decodeParsedCache(JSON.stringify(old), '2023')).toBeNull();
  });

  it('refuses malformed JSON and a non-object seats field', () => {
    expect(decodeParsedCache('not json', '2023')).toBeNull();
    expect(
      decodeParsedCache(
        JSON.stringify({ version: CACHE_VERSION, year: '2023', seats: [] }),
        '2023'
      )
    ).toBeNull();
  });
});
