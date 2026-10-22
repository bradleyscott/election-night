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
  describe('feed base URL', () => {
    test('serves the live cycle from the media feed, which carries no year', () => {
      const source = new NzElectionXmlSource({ year: '2026' });
      expect(source.getName()).toBe(
        'NZ Election XML Feed (https://media.election.net.nz/xml/)'
      );
    });

    test('keeps every finished cycle on the archive host', () => {
      for (const year of ['1996', '2017', '2020', '2023']) {
        const source = new NzElectionXmlSource({ year });
        expect(source.getName()).toBe(
          `NZ Election XML Feed (https://archive.electionresults.govt.nz/electionresults_${year}/xml/)`
        );
      }
    });

    test('defaults to the newest archived cycle', () => {
      const source = new NzElectionXmlSource();
      expect(source.getName()).toContain('/electionresults_2023/xml/');
    });

    test('an explicit base URL still wins over the year', () => {
      const source = new NzElectionXmlSource({
        year: '2026',
        baseUrl: 'http://localhost:3457',
      });
      expect(source.getName()).toBe(
        'NZ Election XML Feed (http://localhost:3457/)'
      );
    });
  });

  test('reads the national count and seat table from election.xml', async () => {
    const source = createSource();
    const status = await source.loadNationalStatus();

    expect(status.parties).toEqual([
      {
        party: 'Red Party',
        votes: 900000,
        listSeats: 4,
        electorateSeats: 18,
        totalSeats: 22,
      },
      {
        party: 'Blue Party',
        votes: 700000,
        listSeats: 15,
        electorateSeats: 9,
        totalSeats: 24,
      },
    ]);
    expect(status.totalVotesCast).toBe(2300000);
    expect(status.percentVotesCast).toBe(77.7);
    expect(status.totalElectoratesFinal).toBe(68);
    expect(status.updated).toBe('2026-11-08T02:14:00');
  });

  test('re-reads election.xml on every poll so seats follow the count', async () => {
    const calls: string[] = [];
    const source = new NzElectionXmlSource({
      baseUrl: BASE_URL,
      fetch: (url) => {
        calls.push(url.slice(BASE_URL.length));
        return fixtureFetch(url);
      },
    });

    await source.loadNationalStatus();
    await source.loadNationalStatus();

    expect(calls.filter((c) => c === 'election.xml')).toHaveLength(2);
  });

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

  test('decodes numeric character references in names', async () => {
    // The live feed writes apostrophes as `&#39;` where the 2017/2020 archives
    // write `&apos;`. Both are valid XML and both must arrive as an apostrophe,
    // or the dashboard renders the reference literally.
    const files: Record<string, string> = {
      'electorates.xml': `<?xml version="1.0" encoding="UTF-8"?>
<electorates>
  <electorate e_no="1">
    <electorate_name>M&#39;KAI, Bay</electorate_name>
  </electorate>
</electorates>`,
      'parties.xml': `<?xml version="1.0" encoding="UTF-8"?>
<parties>
  <party p_no="10">
    <abbrev>RED</abbrev>
    <short_name>Red &amp; Blue Party</short_name>
    <party_name>Red &amp; Blue Party</party_name>
    <registered>yes</registered>
  </party>
</parties>`,
      'candidates.xml': `<?xml version="1.0" encoding="UTF-8"?>
<candidates>
  <candidate c_no="1">
    <candidate_name>O&#39;CONNOR, Damien</candidate_name>
    <electorate>1</electorate>
    <party>10</party>
    <list_no>3</list_no>
  </candidate>
  <candidate c_no="2">
    <candidate_name>KANONGATA&#x27;A, Anahila</candidate_name>
    <electorate>1</electorate>
    <party>10</party>
    <list_no>0</list_no>
  </candidate>
</candidates>`,
      'e01/e01.xml': `<?xml version="1.0" encoding="UTF-8"?>
<electorate e_no="1">
  <statistics>
    <total_votes_cast>1000</total_votes_cast>
    <percent_voting_places_counted>50.0</percent_voting_places_counted>
  </statistics>
  <partyvotes>
    <party p_no="10"><votes>600</votes></party>
  </partyvotes>
  <candidatevotes>
    <candidate c_no="1"><votes>400</votes></candidate>
    <candidate c_no="2"><votes>300</votes></candidate>
  </candidatevotes>
</electorate>`,
    };

    const source = new NzElectionXmlSource({
      baseUrl: BASE_URL,
      fetch: (url) => Promise.resolve(files[url.slice(BASE_URL.length)]!),
    });

    const configs = await source.loadElectorates();
    expect(configs[0]!.electorateName).toBe("M'KAI, Bay");

    const partyList = await source.loadPartyList();
    expect(partyList[0]).toEqual({
      party: 'Red & Blue Party',
      candidate: "O'CONNOR, Damien",
      listRank: 3,
    });

    const raw = await source.fetchResults(configs[0]!);
    expect(raw.candidateVotes).toEqual([
      { candidate: "O'CONNOR, Damien", votes: 400, party: 'Red & Blue Party' },
      {
        candidate: "KANONGATA'A, Anahila",
        votes: 300,
        party: 'Red & Blue Party',
      },
    ]);
  });
});
