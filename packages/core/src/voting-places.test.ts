import { describe, expect, it } from 'vitest';
import {
  hasCounted,
  parseVotingPlaceListing,
  parseVotingPlaceRegistry,
  parseVotingPlaceResult,
  splitVotingPlaceAddress,
} from './voting-places.js';

const REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<votingplaces>
    <votingplace vp_id="361" vp_e_no="34">
        <vp_address>Mobile Team, Team 1, Taken in Ōtāhuhu Electorate</vp_address>
        <vp_lat></vp_lat>
        <vp_lon></vp_lon>
    </votingplace>
    <votingplace vp_id="362" vp_e_no="37">
        <vp_address>Kawakawa Bay Public Hall, 19 Kawakawa-Orere Road, Kawakawa Bay</vp_address>
        <vp_lat>-36.950050406009325</vp_lat>
        <vp_lon>175.1703876225217</vp_lon>
    </votingplace>
    <votingplace vp_id="380" vp_e_no="1">
        <vp_address>Auckland University, Student Engagement Kate Edgar, Room B315, level 3, 34 Princes Street, Auckland City</vp_address>
        <vp_lat>-36.8521</vp_lat>
        <vp_lon>174.7699</vp_lon>
    </votingplace>
</votingplaces>`;

const COUNTED = `<?xml version="1.0" encoding="UTF-8"?>
<votingplace vp_id="380" vp_e_no="1" e_no="1" vp_no="1" updated="2026-10-24T19:20:00">
    <time_received>2026-10-24T19:07:00</time_received>
    <statistics>
        <total_issued_ballot_papers>412</total_issued_ballot_papers>
        <total_party_informals>3</total_party_informals>
        <total_candidate_informals>4</total_candidate_informals>
    </statistics>
</votingplace>`;

const OUTSTANDING = `<?xml version="1.0" encoding="UTF-8"?>
<votingplace vp_id="641" vp_e_no="47" e_no="1" vp_no="4" updated="2026-10-22T15:19:30">
    <time_received></time_received>
    <statistics>
        <total_issued_ballot_papers>0</total_issued_ballot_papers>
    </statistics>
</votingplace>`;

const INDEX_HTML = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html><head><title>Index of /xml/e01/votingplaces</title></head>
<body><h1>Index of /xml/e01/votingplaces</h1>
<table>
<tr><th><a href="?C=N;O=D">Name</a></th><th>Last modified</th><th>Size</th></tr>
<tr><td><a href="/xml/e01/">Parent Directory</a></td><td>&nbsp;</td><td>  - </td></tr>
<tr><td><a href="01-01001.xml">01-01001.xml</a></td><td>2026-10-22 15:19  </td><td>2.1K</td></tr>
<tr><td><a href="01-47004.xml">01-47004.xml</a></td><td>2026-10-22 15:19  </td><td>2.1K</td></tr>
<tr><td><a href="01-47017.xml">01-47017.xml</a></td><td>2026-10-24 19:07  </td><td>2.4K</td></tr>
</table></body></html>`;

describe('splitVotingPlaceAddress', () => {
  it('splits the venue from the rest of the address', () => {
    expect(
      splitVotingPlaceAddress(
        'Auckland University, Student Engagement Kate Edgar, Room B315, level 3, 34 Princes Street, Auckland City'
      )
    ).toEqual({
      name: 'Auckland University',
      address:
        'Student Engagement Kate Edgar, Room B315, level 3, 34 Princes Street, Auckland City',
    });
  });

  it('keeps a label with no address on the name line only', () => {
    expect(
      splitVotingPlaceAddress(
        'Mobile Team, Team 1, Taken in Ōtāhuhu Electorate'
      )
    ).toEqual({
      name: 'Mobile Team',
      address: 'Team 1, Taken in Ōtāhuhu Electorate',
    });
  });

  it('handles an address with no comma at all', () => {
    expect(splitVotingPlaceAddress(' Kaipara Flats School ')).toEqual({
      name: 'Kaipara Flats School',
      address: '',
    });
  });
});

describe('parseVotingPlaceRegistry', () => {
  it('reads the register, including empty coordinates', () => {
    const places = parseVotingPlaceRegistry(REGISTRY);
    expect(places).toHaveLength(3);
    expect(places[0]).toEqual({
      id: 361,
      electorateNo: 34,
      name: 'Mobile Team',
      address: 'Team 1, Taken in Ōtāhuhu Electorate',
      lat: null,
      lon: null,
    });
    expect(places[1]?.lat).toBeCloseTo(-36.9500504);
    expect(places[1]?.lon).toBeCloseTo(175.1703876);
    expect(places[2]?.name).toBe('Auckland University');
  });

  it('keeps a macronised address intact', () => {
    expect(parseVotingPlaceRegistry(REGISTRY)[0]?.address).toContain('Ōtāhuhu');
  });

  it('returns nothing for an empty body', () => {
    expect(parseVotingPlaceRegistry('')).toEqual([]);
    expect(parseVotingPlaceRegistry('<votingplaces/>')).toEqual([]);
  });

  it('skips an entry with no vp_id', () => {
    const places = parseVotingPlaceRegistry(
      '<votingplaces><votingplace><vp_address>x</vp_address></votingplace><votingplace vp_id="9"><vp_address>y</vp_address></votingplace></votingplaces>'
    );
    expect(places.map((p) => p.id)).toEqual([9]);
  });
});

describe('parseVotingPlaceListing', () => {
  it('reads the place files, not the parent-directory link', () => {
    expect(parseVotingPlaceListing(INDEX_HTML)).toEqual([
      { electorateNo: 1, placeNo: 1, file: '01-01001.xml' },
      { electorateNo: 47, placeNo: 4, file: '01-47004.xml' },
      { electorateNo: 47, placeNo: 17, file: '01-47017.xml' },
    ]);
  });

  it('de-duplicates a file listed twice', () => {
    const html = '<a href="01-01001.xml">a</a> <a href="01-01001.xml">b</a>';
    expect(parseVotingPlaceListing(html)).toHaveLength(1);
  });

  it('reads nothing from a page that is not a listing', () => {
    expect(parseVotingPlaceListing('<!DOCTYPE html><p>Forbidden</p>')).toEqual(
      []
    );
  });
});

describe('parseVotingPlaceResult', () => {
  it('reads a counted place', () => {
    expect(parseVotingPlaceResult(COUNTED)).toEqual({
      id: 380,
      electorateNo: 1,
      placeNo: 1,
      countedAt: '2026-10-24T19:07:00',
      issued: 412,
    });
  });

  it('reports an outstanding place as uncounted, not as zero votes', () => {
    const result = parseVotingPlaceResult(OUTSTANDING);
    expect(result?.countedAt).toBeNull();
    expect(hasCounted(result!)).toBe(false);
  });

  it('distinguishes a counted place that issued nothing', () => {
    const result = parseVotingPlaceResult(
      '<votingplace vp_id="2" vp_e_no="1" vp_no="7"><time_received>2026-10-24T19:30:00</time_received><statistics><total_issued_ballot_papers>0</total_issued_ballot_papers></statistics></votingplace>'
    );
    expect(result?.issued).toBe(0);
    expect(hasCounted(result!)).toBe(true);
  });

  it('returns null for a body that is not a place result', () => {
    expect(parseVotingPlaceResult('')).toBeNull();
    expect(parseVotingPlaceResult('<html><body>404</body></html>')).toBeNull();
  });
});
