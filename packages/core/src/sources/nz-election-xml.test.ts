import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { NzElectionXmlSource } from './nz-election-xml.js';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/xml'
);
const BASE_URL = 'https://example.test/xml/';

function fixtureFetch(url: string): Promise<string> {
  const path = url.slice(BASE_URL.length);
  return Promise.resolve(readFileSync(join(fixturesDir, path), 'utf-8'));
}

function createSource() {
  return new NzElectionXmlSource({
    baseUrl: BASE_URL,
    fetch: fixtureFetch,
  });
}

describe('NzElectionXmlSource', () => {
  test('fetches reference data only once across concurrent loads', async () => {
    const calls: string[] = [];
    const source = new NzElectionXmlSource({
      baseUrl: BASE_URL,
      fetch: (url) => {
        calls.push(url.slice(BASE_URL.length));
        return fixtureFetch(url);
      },
    });

    await Promise.all([source.loadElectorates(), source.loadPartyList()]);
    await source.loadElectorates();

    const referenceCalls = calls.filter((c) => c.endsWith('.xml'));
    expect(referenceCalls.sort()).toEqual([
      'candidates.xml',
      'electorates.xml',
      'parties.xml',
    ]);
  });

  test('loads electorates from electorates.xml sorted by e_no', async () => {
    const source = createSource();
    const configs = await source.loadElectorates();

    expect(configs).toEqual([
      {
        electorateName: 'Auckland Central',
        url: `${BASE_URL}e01/e01.xml`,
      },
      {
        electorateName: 'Wellington Central',
        url: `${BASE_URL}e02/e02.xml`,
      },
    ]);
  });

  test('builds party lists from candidates.xml with list_no and party names', async () => {
    const source = createSource();
    const partyList = await source.loadPartyList();

    expect(partyList).toEqual([
      { party: 'Blue Party', candidate: 'DAVE, David', listRank: 1 },
      { party: 'Red Party', candidate: 'ALICE, Alison', listRank: 1 },
      { party: 'Red Party', candidate: 'CAROL, Caroline', listRank: 2 },
    ]);
  });

  test('fetches and parses electorate results with party enrichment', async () => {
    const source = createSource();
    const configs = await source.loadElectorates();
    const raw = await source.fetchResults(configs[0]);

    expect(raw.electorateName).toBe('Auckland Central');
    expect(raw.votesCounted).toBe(10000);
    expect(raw.votePercentageCounted).toBeCloseTo(0.425);
    expect(raw.partyVotes).toEqual([
      { candidate: 'Red Party', votes: 6000 },
      { candidate: 'Blue Party', votes: 4000 },
    ]);
    expect(raw.candidateVotes).toEqual([
      { candidate: 'ALICE, Alison', votes: 7000, party: 'Red Party' },
      { candidate: 'BOB, Robert', votes: 3000, party: 'Blue Party' },
    ]);
  });

  test('handles electorates with a single candidate', async () => {
    const source = createSource();
    const configs = await source.loadElectorates();
    const raw = await source.fetchResults(configs[1]);

    expect(raw.electorateName).toBe('Wellington Central');
    expect(raw.candidateVotes).toEqual([
      { candidate: 'DAVE, David', votes: 4800, party: 'Blue Party' },
    ]);
  });
});
