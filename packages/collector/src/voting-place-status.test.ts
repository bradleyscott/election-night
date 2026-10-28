import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { VotingPlaceStatusService } from './voting-place-status.js';

const ELECTORATES = `<?xml version="1.0" encoding="UTF-8"?>
<electorates>
  <electorate e_no="1"><electorate_name>Auckland Central</electorate_name></electorate>
  <electorate e_no="2"><electorate_name>Banks Peninsula</electorate_name></electorate>
</electorates>`;

const REGISTER = `<?xml version="1.0" encoding="UTF-8"?>
<votingplaces>
  <votingplace vp_id="380" vp_e_no="1">
    <vp_address>Auckland University, Student Engagement Kate Edgar, Room B315, 34 Princes Street, Auckland City</vp_address>
    <vp_lat>-36.8521</vp_lat><vp_lon>174.7699</vp_lon>
  </votingplace>
  <votingplace vp_id="381" vp_e_no="1">
    <vp_address>Ponsonby Community Centre, 20 Ponsonby Terrace, Ponsonby</vp_address>
    <vp_lat>-36.8555</vp_lat><vp_lon>174.7456</vp_lon>
  </votingplace>
  <votingplace vp_id="390" vp_e_no="1">
    <vp_address>Mobile Team, Team 2, Taken in Auckland Central</vp_address>
    <vp_lat></vp_lat><vp_lon></vp_lon>
  </votingplace>
  <votingplace vp_id="395" vp_e_no="2">
    <vp_address>Overseas, Sydney, Australia</vp_address>
    <vp_lat>-33.8688</vp_lat><vp_lon>151.2093</vp_lon>
  </votingplace>
</votingplaces>`;

const LISTING = `<html><body><table>
<tr><td><a href="01-01001.xml">01-01001.xml</a></td><td>2026-10-24 19:07</td><td>2.4K</td></tr>
<tr><td><a href="01-01002.xml">01-01002.xml</a></td><td>2026-10-22 15:19</td><td>2.1K</td></tr>
<tr><td><a href="01-01005.xml">01-01005.xml</a></td><td>2026-10-24 19:07</td><td>2.2K</td></tr>
<tr><td><a href="01-02003.xml">01-02003.xml</a></td><td>2026-10-24 19:12</td><td>2.4K</td></tr>
</table></body></html>`;

const placeFile = (
  id: number,
  electorateNo: number,
  placeNo: number,
  received: string
) => `<?xml version="1.0" encoding="UTF-8"?>
<votingplace vp_id="${id}" vp_e_no="${electorateNo}" e_no="1" vp_no="${placeNo}" updated="2026-10-24T19:20:00">
  <time_received>${received}</time_received>
  <statistics><total_issued_ballot_papers>410</total_issued_ballot_papers></statistics>
</votingplace>`;

type Fixture = {
  routes?: Record<string, { status?: number; body: string }>;
  listingStatus?: number;
};

async function startFeed(fixture: Fixture = {}): Promise<{
  baseUrl: string;
  hits: Record<string, number>;
  routes: Record<string, { status?: number; body: string }>;
  close: () => Promise<void>;
}> {
  const routes: Record<string, { status?: number; body: string }> = {
    '/electorates.xml': { body: ELECTORATES },
    '/votingplaces.xml': { body: REGISTER },
    '/e01/votingplaces/': {
      status: fixture.listingStatus ?? 200,
      body: fixture.listingStatus ? '<html>Forbidden</html>' : LISTING,
    },
    '/e01/votingplaces/01-01001.xml': {
      body: placeFile(380, 1, 1, '2026-10-24T19:07:00'),
    },
    '/e01/votingplaces/01-01002.xml': {
      body: placeFile(381, 1, 2, ''),
    },
    '/e01/votingplaces/01-01005.xml': {
      body: placeFile(390, 1, 5, '2026-10-24T19:09:30'),
    },
    '/e01/votingplaces/01-02003.xml': {
      body: placeFile(395, 2, 3, '2026-10-24T19:12:00'),
    },
    ...fixture.routes,
  };
  const hits: Record<string, number> = {};
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    hits[path] = (hits[path] ?? 0) + 1;
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(route.status ?? 200, { 'content-type': 'text/plain' });
    res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('no port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    hits,
    routes,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('VotingPlaceStatusService', () => {
  it('joins the register with each place result and groups them', async () => {
    const feed = await startFeed();
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });

    const result = await service.placesFor('Auckland Central');
    expect(result).not.toBeNull();
    expect(result!.available).toBe(true);
    expect(result!.total).toBe(4);
    expect(result!.counted).toBe(3);

    const byId = new Map(result!.places.map((p) => [p.id, p]));
    // In-seat booth, counted, drawn at its coordinates.
    expect(byId.get(380)).toMatchObject({
      name: 'Auckland University',
      group: 'seat',
      countedAt: '2026-10-24T19:07:00',
    });
    expect(byId.get(380)!.lat).toBeCloseTo(-36.8521);
    // In-seat booth, outstanding.
    expect(byId.get(381)).toMatchObject({ group: 'seat', countedAt: null });
    // Registered against the seat with no coordinates: a mobile team.
    expect(byId.get(390)).toMatchObject({ group: 'mobile', lat: null });
    // Stands in Banks Peninsula but counts for Auckland Central: elsewhere.
    expect(byId.get(395)).toMatchObject({
      group: 'elsewhere',
      electorateName: 'Banks Peninsula',
    });

    expect(result!.places.filter((p) => p.group === 'seat')).toHaveLength(2);
    expect(result!.places.filter((p) => p.group === 'elsewhere')).toHaveLength(
      1
    );
    expect(result!.places.filter((p) => p.group === 'mobile')).toHaveLength(1);
  });

  it('gives a Māori seat no in-seat places, because vp_e_no never names one', async () => {
    // The live register only ever carries a general electorate number, so a
    // Māori seat's places are all filed elsewhere even though they stand on it.
    const feed = await startFeed({
      routes: {
        '/electorates.xml': {
          body: `<?xml version="1.0" encoding="UTF-8"?>
<electorates>
  <electorate e_no="1"><electorate_name>Auckland Central</electorate_name></electorate>
  <electorate e_no="2"><electorate_name>Banks Peninsula</electorate_name></electorate>
  <electorate e_no="65"><electorate_name>Te Tai Tonga</electorate_name></electorate>
</electorates>`,
        },
        '/e65/votingplaces/': {
          body: `<html><body><table>
<tr><td><a href="65-01001.xml">65-01001.xml</a></td></tr>
<tr><td><a href="65-02003.xml">65-02003.xml</a></td></tr>
</table></body></html>`,
        },
        '/e65/votingplaces/65-01001.xml': {
          body: placeFile(380, 1, 1, '2026-10-24T19:07:00'),
        },
        '/e65/votingplaces/65-02003.xml': {
          body: placeFile(395, 2, 3, ''),
        },
      },
    });
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });

    const result = await service.placesFor('Te Tai Tonga');
    expect(result).not.toBeNull();
    expect(result!.available).toBe(true);
    expect(result!.total).toBe(2);
    expect(result!.counted).toBe(1);
    expect(result!.places.map((p) => p.group)).toEqual([
      'elsewhere',
      'elsewhere',
    ]);
    expect(result!.places.map((p) => p.electorateName)).toEqual([
      'Auckland Central',
      'Banks Peninsula',
    ]);
  });

  it('matches the electorate name macron- and punctuation-insensitively', async () => {
    const feed = await startFeed({
      routes: {
        '/electorates.xml': {
          body: `<electorates><electorate e_no="1"><electorate_name>Ōtāhuhu</electorate_name></electorate></electorates>`,
        },
      },
    });
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });
    expect(await service.placesFor('Otahuhu')).not.toBeNull();
  });

  it('answers null for an electorate the feed does not list', async () => {
    const feed = await startFeed();
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });
    expect(await service.placesFor('Nowhere Central')).toBeNull();
  });

  it('reports an unlistable directory as unavailable rather than empty', async () => {
    const feed = await startFeed({ listingStatus: 403 });
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2023',
    });
    expect(await service.placesFor('Auckland Central')).toEqual({
      electorateName: 'Auckland Central',
      year: '2023',
      available: false,
      reason: 'not-live',
      counted: 0,
      total: 0,
      places: [],
    });
  });

  it('caches the answer for the TTL and refetches after it', async () => {
    const feed = await startFeed();
    cleanup = feed.close;
    let now = 1_000;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
      cacheTtlMs: 30_000,
      now: () => now,
    });

    await service.placesFor('Auckland Central');
    const listingHits = feed.hits['/e01/votingplaces/']!;
    await service.placesFor('Auckland Central');
    expect(feed.hits['/e01/votingplaces/']).toBe(listingHits);
    expect(feed.hits['/votingplaces.xml']).toBe(1);

    now += 30_001;
    await service.placesFor('Auckland Central');
    expect(feed.hits['/e01/votingplaces/']).toBe(listingHits + 1);
    // The register is long-lived: only the seat's results are re-read.
    expect(feed.hits['/votingplaces.xml']).toBe(1);
  });

  it('single-flights concurrent requests for the same seat', async () => {
    const feed = await startFeed();
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });
    await Promise.all([
      service.placesFor('Auckland Central'),
      service.placesFor('Auckland Central'),
      service.placesFor('Auckland Central'),
    ]);
    expect(feed.hits['/e01/votingplaces/']).toBe(1);
  });

  it('treats a place result it cannot read as outstanding, keeping the total', async () => {
    const feed = await startFeed({
      routes: {
        '/e01/votingplaces/01-01002.xml': { status: 500, body: 'boom' },
      },
    });
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });
    const result = await service.placesFor('Auckland Central');
    // The place still occupies its slot in the denominator; it is reported as
    // outstanding rather than dropped, so the total does not wobble.
    expect(result!.total).toBe(4);
    expect(result!.counted).toBe(3);
    expect(result!.places.filter((p) => p.countedAt === null)).toHaveLength(1);
  });

  it('remembers a place id after its result body stops loading', async () => {
    const feed = await startFeed();
    cleanup = feed.close;
    let now = 1_000;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
      cacheTtlMs: 1_000,
      now: () => now,
    });

    const first = await service.placesFor('Auckland Central');
    expect(first!.places.find((p) => p.id === 381)).toMatchObject({
      countedAt: null,
    });

    // The file now fails. The learned id keeps the place identifiable, so its
    // marker does not disappear from the map on a single bad poll.
    feed.routes['/e01/votingplaces/01-01002.xml'] = {
      status: 500,
      body: 'boom',
    };
    now += 1_001;
    const second = await service.placesFor('Auckland Central');
    expect(second!.places.find((p) => p.id === 381)).toMatchObject({
      group: 'seat',
      countedAt: null,
      name: 'Ponsonby Community Centre',
    });
  });

  it('reports an empty directory as available with nothing due', async () => {
    const feed = await startFeed({
      routes: {
        '/e01/votingplaces/': { body: '<html><body></body></html>' },
      },
    });
    cleanup = feed.close;
    const service = new VotingPlaceStatusService({
      baseUrl: feed.baseUrl,
      electionYear: '2026',
    });
    const result = await service.placesFor('Auckland Central');
    expect(result).toMatchObject({
      available: true,
      total: 0,
      counted: 0,
      places: [],
    });
  });
});
