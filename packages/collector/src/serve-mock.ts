import 'dotenv/config';
import http from 'http';
import arg from 'arg';
import {
  buildMockElectionSet,
  DEFAULT_MOCK_ELECTION_YEAR,
  isMockElectionYear,
  MOCK_ELECTION_YEARS,
  MOCK_ELECTORATE_SETS,
  type MockElectionYear,
} from './synthetic-electorates.js';
import type { ElectorateResults } from '@election-night/core/types';
import { normalizeElectorateName } from '@election-night/core/electorate-names';
import fs from 'node:fs';
import path from 'node:path';

// ---- CLI ----
//
// Parsed before any feed data is built, because the electorate list (and
// therefore every candidate, `e_no` and result) depends on the cycle.

const parsed = arg(
  {
    '--port': Number,
    '--stage': String,
    '--auto-step': Number,
    '--year': String,
    '--help': Boolean,
    '-p': '--port',
    '-y': '--year',
    '-h': '--help',
  },
  { permissive: true }
);

if (parsed['--help']) {
  console.log(`
Usage: tsx src/serve-mock.ts [options]

Serves a mock version of the Electoral Commission XML feed.

Options:
  --port, -p <number>    Listen port (default: 3457)
  --year, -y <year>      Election cycle to replay: ${MOCK_ELECTION_YEARS.join(', ')}
                         (default: ${DEFAULT_MOCK_ELECTION_YEAR}, or MOCK_ELECTION_YEAR)
  --stage <name>         Start stage: early, mid, late, full (default: early)
  --auto-step <ms>       Auto-advance stage every N milliseconds
  --help, -h             Show this message

Examples:
  # Replay the 2026 general election: 64 general + 7 Māori electorates
  npm run start:mock -- --year 2026
  XML_FEED_BASE_URL=http://localhost:3457/ ELECTION_YEAR=2026 npm run start:collector
`);
  process.exit(0);
}

const yearArg = parsed['--year'] ?? process.env.MOCK_ELECTION_YEAR;
if (yearArg !== undefined && !isMockElectionYear(yearArg)) {
  console.error(
    `Unknown year "${yearArg}", valid: ${MOCK_ELECTION_YEARS.join(', ')}`
  );
  process.exit(1);
}
const ELECTION_YEAR: MockElectionYear = yearArg ?? DEFAULT_MOCK_ELECTION_YEAR;

const PORT = parsed['--port'] || Number(process.env.MOCK_PORT) || 3457;

// ---- Feed data for the selected cycle ----

const {
  electorates: MOCK_ELECTORATES,
  stages,
  parties: MOCK_PARTIES,
  candidates: MOCK_CANDIDATES,
  election: MOCK_ELECTION,
  pollingDate: POLLING_DATE,
  enrolmentByElectorate: ENROLMENT_BY_ELECTORATE,
} = buildMockElectionSet(ELECTION_YEAR);

const STAGES: ElectorateResults[][] = [
  stages.early,
  stages.mid,
  stages.late,
  stages.full,
];
const STAGE_NAMES = ['early', 'mid', 'late', 'full'];

let currentStage = 0;

/**
 * When the current stage took effect, in milliseconds — the mock's
 * `Last-Modified`. It moves only when the stage does, so a collector that asks
 * with `If-Modified-Since` gets a 304 until `/advance` (or `--auto-step`) makes
 * every file say something new.
 *
 * Each advance moves it at least one second past the previous value. HTTP dates
 * have one-second resolution, so a stage changed inside the second the previous
 * `Last-Modified` already named could not be observed by a conditional client —
 * the mock would be unable to express a change at all. The cost is that the
 * mock's clock can run a few seconds ahead after rapid manual advances, which
 * only affects the mock.
 */
let stageUpdatedAt = Date.now();

function setStage(next: number): void {
  if (next === currentStage) return;
  currentStage = next;
  stageUpdatedAt = Math.max(
    Date.now(),
    Math.floor(stageUpdatedAt / 1000) * 1000 + 1000
  );
}

/** The stage's `Last-Modified` at the second resolution HTTP compares with. */
function stageLastModifiedMs(): number {
  return Math.floor(stageUpdatedAt / 1000) * 1000;
}

// ---- Reference data (mock parties, electorates, candidates) ----

const PARTY_INDEX = new Map(MOCK_PARTIES.map((p) => [p.name, p.pNo]));

type CandidateRef = {
  cNo: number;
  name: string;
  eNo: number;
  pNo: number;
  listNo: number;
};

/**
 * The fixture keeps the Commission's own `c_no`, `e_no` and list ranks.
 *
 * Keyed by electorate as well as name: the 2020 archive has two candidates
 * called "BENNETT, David" in different seats, so a name-only lookup would give
 * one of them the other's `c_no` when the results are serialized.
 */
const candidates: CandidateRef[] = MOCK_CANDIDATES;
const candidateBySeatAndName = new Map(
  candidates.map((c) => [`${c.eNo}:${c.name}`, c])
);

function buildNameToResults(): Map<string, ElectorateResults[]> {
  const map = new Map<string, ElectorateResults[]>();
  for (let stage = 0; stage < STAGES.length; stage++) {
    for (const result of STAGES[stage]) {
      let list = map.get(result.electorateName);
      if (!list) {
        list = [];
        map.set(result.electorateName, list);
      }
      list[stage] = result;
    }
  }
  return map;
}

const resultsMap = buildNameToResults();

// ---- XML serialization ----
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8"?>';
}

function renderPartiesXml(): string {
  const parties = MOCK_PARTIES.map(
    (p) => `    <party p_no="${p.pNo}">
        <abbrev>${escapeXml(p.abbrev)}</abbrev>
        <short_name>${escapeXml(p.name)}</short_name>
        <party_name>${escapeXml(p.name)}</party_name>
        <registered>${p.registered ? 'yes' : 'no'}</registered>
    </party>`
  ).join('\n');
  return `${xmlDeclaration()}\n<parties>\n${parties}\n</parties>\n`;
}

function renderElectoratesXml(): string {
  const electorates = MOCK_ELECTORATES.map(
    (e, i) => `    <electorate e_no="${i + 1}">
        <electorate_name>${escapeXml(e.name)}</electorate_name>
    </electorate>`
  ).join('\n');
  return `${xmlDeclaration()}\n<electorates>\n${electorates}\n</electorates>\n`;
}

/**
 * `election.xml`, the national count and seat table the real feed publishes.
 *
 * At the final stage the Commission's own table is replayed verbatim, so the
 * mock cannot disagree with the result it is replaying. Earlier stages are
 * derived from the partial count with the same 120-seat quota and the same
 * overhang rule; that is fixture logic, not collector logic — the product
 * reads seat numbers off the feed and never derives them.
 *
 * Parliament is 120 seats, not 120 list seats. Allocating the quota over 120
 * and adding the electorate winners on top made the mock publish a 191-seat
 * parliament (National 90), which a dry run then presented as a result.
 */
function renderElectionXml(): string {
  const stage = STAGES[currentStage];
  const finalStage = currentStage === STAGES.length - 1;
  const official = finalStage ? MOCK_ELECTION : null;

  const votes = new Map<string, number>();
  const electorateSeats = new Map<string, number>();
  let totalVotesCast = 0;
  let totalEnrolment = 0;
  let electoratesFinal = 0;

  for (const result of stage) {
    totalVotesCast += result.votesCounted;
    totalEnrolment += ENROLMENT_BY_ELECTORATE.get(result.electorateName) ?? 0;
    if (result.votePercentageCounted >= 1) electoratesFinal += 1;
    for (const party of result.partyVotes) {
      votes.set(
        party.candidate,
        (votes.get(party.candidate) ?? 0) + party.votes
      );
    }
    const leader = [...result.candidateVotes].sort(
      (a, b) => b.votes - a.votes
    )[0];
    if (leader?.party && result.votesCounted > 0) {
      electorateSeats.set(
        leader.party,
        (electorateSeats.get(leader.party) ?? 0) + 1
      );
    }
  }

  const totalPartyVotes = [...votes.values()].reduce((sum, v) => sum + v, 0);
  const totalSeatsByParty = new Map<string, number>();
  if (totalPartyVotes > 0) {
    const eligible = [...votes.entries()].filter(
      ([party, v]) =>
        v / totalPartyVotes >= 0.05 || (electorateSeats.get(party) ?? 0) > 0
    );
    // 120 is the size of parliament, not the number of list seats: electorate
    // seats are part of a party's total, and a party that wins more electorates
    // than its share allows keeps them as an overhang. Allocating 120 *list*
    // seats and adding the electorates on top produced a 191-seat parliament.
    const quotients = eligible.map(([party, v]) => ({
      party,
      exact: (v / totalPartyVotes) * 120,
    }));
    let allocated = 0;
    for (const q of quotients) {
      const base = Math.floor(q.exact);
      totalSeatsByParty.set(q.party, base);
      allocated += base;
    }
    const remainders = quotients
      .map((q) => ({
        party: q.party,
        remainder: q.exact - Math.floor(q.exact),
      }))
      .sort((a, b) => b.remainder - a.remainder);
    for (
      let i = 0;
      allocated < 120 && remainders.length > 0;
      i++, allocated++
    ) {
      const { party } = remainders[i % remainders.length]!;
      totalSeatsByParty.set(party, (totalSeatsByParty.get(party) ?? 0) + 1);
    }
  }

  const officialByPNo = new Map(
    (official?.parties ?? []).map((party) => [party.pNo, party])
  );

  // `election.xml` reports the parties with a national status, not every party
  // in `parties.xml` (2026: 17 rows against 36 registrations). Mirroring that
  // is not cosmetic: some unregistered parties share a `short_name`, and a row
  // per registration would give the collector two summary rows with the same
  // name.
  const reportedPNos = new Set(MOCK_ELECTION.parties.map((party) => party.pNo));
  const reportedParties = MOCK_PARTIES.filter((party) =>
    reportedPNos.has(party.pNo)
  );

  const rows = reportedParties
    .map((party) => {
      const officialRow = officialByPNo.get(party.pNo);
      if (officialRow) {
        return `    <party p_no="${party.pNo}">
        <votes>${officialRow.votes}</votes>
        <percent_votes>${officialRow.percentVotes.toFixed(2)}</percent_votes>
        <party_seats>${officialRow.listSeats}</party_seats>
        <candidate_seats>${officialRow.electorateSeats}</candidate_seats>
        <total_seats>${officialRow.totalSeats}</total_seats>
    </party>`;
      }

      const electorates = electorateSeats.get(party.name) ?? 0;
      // A party keeps every electorate it wins, even beyond its allocation.
      const total = Math.max(
        totalSeatsByParty.get(party.name) ?? 0,
        electorates
      );
      const list = total - electorates;
      return `    <party p_no="${party.pNo}">
        <votes>${votes.get(party.name) ?? 0}</votes>
        <percent_votes>${totalPartyVotes > 0 ? (((votes.get(party.name) ?? 0) / totalPartyVotes) * 100).toFixed(2) : '0'}</percent_votes>
        <party_seats>${list}</party_seats>
        <candidate_seats>${electorates}</candidate_seats>
        <total_seats>${total}</total_seats>
    </party>`;
    })
    .join('\n');

  const percentFinal =
    MOCK_ELECTORATES.length > 0
      ? ((electoratesFinal / MOCK_ELECTORATES.length) * 100).toFixed(2)
      : '0.00';
  const percentVotesCast =
    official !== null
      ? official.percentVotesCast.toFixed(1)
      : totalEnrolment > 0
        ? ((totalVotesCast / totalEnrolment) * 100).toFixed(1)
        : '0.0';

  return `${xmlDeclaration()}
<election updated="${new Date().toISOString()}">
    <statistics>
        <total_voting_places_counted>${stage.length}</total_voting_places_counted>
        <percent_voting_places_counted>${percentFinal}</percent_voting_places_counted>
        <total_votes_cast>${official?.totalVotesCast ?? totalVotesCast}</total_votes_cast>
        <percent_votes_cast>${percentVotesCast}</percent_votes_cast>
        <total_electorates_final>${electoratesFinal}</total_electorates_final>
        <percent_electorates_final>${percentFinal}</percent_electorates_final>
        <total_minimal_votes>${official?.totalMinimalVotes ?? 0}</total_minimal_votes>
        <total_special_votes>${official?.totalSpecialVotes ?? 0}</total_special_votes>
        <total_registered_parties>${MOCK_PARTIES.filter((p) => p.registered).length}</total_registered_parties>
    </statistics>
    <partystatus>
${rows}
    </partystatus>
</election>
`;
}

function renderCandidatesXml(): string {
  const body = candidates
    .map(
      (c) => `    <candidate c_no="${c.cNo}">
        <candidate_name>${escapeXml(c.name)}</candidate_name>
        <electorate>${c.eNo}</electorate>
        <party>${c.pNo}</party>
        <list_no>${c.listNo}</list_no>
    </candidate>`
    )
    .join('\n');
  return `${xmlDeclaration()}\n<candidates>\n${body}\n</candidates>\n`;
}

function renderElectorateXml(results: ElectorateResults, eNo: number): string {
  const pctNumber = results.votePercentageCounted * 100;
  const pct = pctNumber.toFixed(1);

  const partyVotes = results.partyVotes
    .map((pv) => {
      const pNo = PARTY_INDEX.get(pv.candidate);
      if (!pNo) return null;
      return `        <party p_no="${pNo}">
            <votes>${pv.votes}</votes>
        </party>`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  const candidateVotes = results.candidateVotes
    .map((cv) => {
      const ref = candidateBySeatAndName.get(`${eNo}:${cv.candidate}`);
      if (!ref) return null;
      return `        <candidate c_no="${ref.cNo}">
            <votes>${cv.votes}</votes>
        </candidate>`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  const turnout =
    results.percentVotesCast !== undefined
      ? (results.percentVotesCast * 100).toFixed(1)
      : '0.0';
  const final = results.votePercentageCounted >= 1 ? 'true' : 'false';

  return `${xmlDeclaration()}
<electorate e_no="${eNo}" final="${final}" updated="${new Date().toISOString()}">
    <statistics>
        <total_voting_places_counted>${Math.round(pctNumber)}</total_voting_places_counted>
        <percent_voting_places_counted>${pct}</percent_voting_places_counted>
        <total_votes_cast>${results.votesCounted}</total_votes_cast>
        <percent_votes_cast>${turnout}</percent_votes_cast>
        <total_party_informals>0</total_party_informals>
        <total_candidate_informals>0</total_candidate_informals>
        <total_registered_parties>${MOCK_PARTIES.filter((p) => p.registered).length}</total_registered_parties>
        <total_candidates>${results.candidateVotes.length}</total_candidates>
    </statistics>
    <partyvotes>
${partyVotes}
    </partyvotes>
    <candidatevotes>
${candidateVotes}
    </candidatevotes>
</electorate>
`;
}

function renderIndex(): string {
  const links = MOCK_ELECTORATES.map((e, i) => {
    const padded = String(i + 1).padStart(2, '0');
    return `<li><a href="/e${padded}/e${padded}.xml">${escapeXml(e.name)}</a></li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Mock XML Election Results</title></head>
<body>
<h1>Mock XML Election Results</h1>
<p>Cycle: <strong>${ELECTION_YEAR}</strong> (${MOCK_ELECTORATES.length} electorates)</p>
<p>Stage: <strong>${STAGE_NAMES[currentStage]}</strong> (${currentStage + 1}/${STAGES.length})</p>
<p>Point the collector at this server:</p>
<pre>XML_FEED_BASE_URL=http://localhost:${PORT}/ ELECTION_YEAR=${ELECTION_YEAR} npm run start:collector</pre>
<p>Advance: <code>curl -X POST http://localhost:${PORT}/advance</code></p>
<p>Reset: <code>curl -X POST http://localhost:${PORT}/reset</code></p>
<ul>
<li><a href="/candidates.xml">candidates.xml</a></li>
<li><a href="/parties.xml">parties.xml</a></li>
<li><a href="/electorates.xml">electorates.xml</a></li>
<li><a href="/votingplaces.xml">votingplaces.xml</a></li>
<li><a href="/e01/votingplaces/">e01/votingplaces/</a></li>
</ul>
<ul>
${links}
</ul>
</body>
</html>`;
}

// ---- CLI argument handling ----

const stageArg = parsed['--stage'];
if (stageArg) {
  const idx = STAGE_NAMES.indexOf(stageArg);
  if (idx !== -1) setStage(idx);
  else
    console.error(
      `Unknown stage "${stageArg}", valid: ${STAGE_NAMES.join(', ')}`
    );
}

const autoStepMs = parsed['--auto-step'];
let autoStepTimer: ReturnType<typeof setInterval> | null = null;

// ---- voting places ----
//
// The real feed publishes a register (`votingplaces.xml`) and then, per
// electorate, a directory listing plus one small result file per place. Only
// the cycle being counted has that directory — the archive host forbids
// listing — which is why the dashboard asks for a seat's places on demand.
//
// The mock invents a plausible register: three booths in each seat, one advance
// place that belongs to a neighbouring seat (so the map draws it as a circle
// away from the seat), and one mobile team with no coordinates at all. Booth
// coordinates are anchored on real towns because the mock has no geometry of
// its own; the point is the four legend states switching over time, not the
// geography.
//
// One thing it must copy from the live feed rather than improve on: `vp_e_no`
// never holds a Māori electorate number, so no place is registered against a
// Māori seat. Booths in the seven Māori seats are therefore filed under a
// general electorate (as the real register files them) while still counting
// towards the Māori seat — otherwise a dry run would draw in-seat squares that
// production can never produce.

const PLACE_ANCHORS: { town: string; lat: number; lon: number }[] = [
  { town: 'Whangārei', lat: -35.7251, lon: 174.3237 },
  { town: 'Auckland', lat: -36.8485, lon: 174.7633 },
  { town: 'Hamilton', lat: -37.787, lon: 175.2793 },
  { town: 'Tauranga', lat: -37.6878, lon: 176.1651 },
  { town: 'Rotorua', lat: -38.1368, lon: 176.2497 },
  { town: 'Gisborne', lat: -38.6623, lon: 178.0176 },
  { town: 'Napier', lat: -39.4928, lon: 176.912 },
  { town: 'New Plymouth', lat: -39.0556, lon: 174.0752 },
  { town: 'Palmerston North', lat: -40.3523, lon: 175.6082 },
  { town: 'Wellington', lat: -41.2866, lon: 174.7756 },
  { town: 'Nelson', lat: -41.2706, lon: 173.284 },
  { town: 'Christchurch', lat: -43.5321, lon: 172.6362 },
  { town: 'Dunedin', lat: -45.8788, lon: 170.5028 },
  { town: 'Invercargill', lat: -46.4132, lon: 168.3538 },
];

const PLACE_SUFFIXES = [
  'Primary School',
  'Community Hall',
  'Public Library',
  'Returning Office',
  'Church Hall',
  'Sports Centre',
  'Community Centre',
  'RSA Hall',
];

const PLACE_ROADS = [
  'Queen Street',
  'Victoria Avenue',
  'Cameron Road',
  'Fergusson Drive',
  'Grey Street',
  'Princes Street',
  'Main Road',
  'Rimu Street',
];

const BOOTHS_PER_SEAT = 3;

/** Stable pseudo-random in [0, 1) from a seed, so a place never moves. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Every ring in a GeoJSON Polygon/MultiPolygon coordinate tree. */
function collectRings(coords: unknown): [number, number][][] {
  const rings: [number, number][][] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || node.length === 0) return;
    const isPoint =
      typeof node[0] === 'number' && typeof (node as unknown[])[1] === 'number';
    if (isPoint) return;
    const isRing = Array.isArray(node[0]) && typeof node[0][0] === 'number';
    if (isRing) {
      rings.push(node as [number, number][]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coords);
  return rings;
}

/** Bounding-box area, which ranks rings without a projection. */
function ringArea(ring: [number, number][]): number {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return (maxLon - minLon) * (maxLat - minLat);
}

/**
 * A representative point per electorate, taken from the boundary geometry the
 * dashboard ships. The mock has no geography of its own, and invented
 * coordinates put every place outside the seat the map zooms to, so a dry run
 * could not see the marks it was meant to be exercising. Reading the same
 * GeoJSON the map draws is not new coupling: `synthetic-electorates.test.ts`
 * already asserts this fixture against the same manifest.
 */
function loadElectorateCentres(): Map<string, { lat: number; lon: number }> {
  const centres = new Map<string, { lat: number; lon: number }>();
  // 2020 and 2023 were fought on the same boundaries, so the map only ships
  // one set of polygons for the pair.
  const boundaryYear = ELECTION_YEAR === '2020' ? '2023' : ELECTION_YEAR;
  const dir = path.resolve(
    import.meta.dirname,
    '../../dashboard/public/boundaries',
    boundaryYear
  );
  for (const file of [
    'general-electorates.geojson',
    'maori-electorates.geojson',
  ]) {
    let parsed: {
      features?: {
        properties?: { name?: string };
        geometry?: { coordinates?: unknown };
      }[];
    };
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    for (const feature of parsed.features ?? []) {
      const name = feature.properties?.name;
      if (!name) continue;
      // Use the tightest ring of the seat, not the average of every vertex: a
      // seat that includes coastal water (Auckland Central does) or outlying
      // islands would otherwise get a "centre" out at sea, and the marks would
      // land nowhere near the polygon the map zooms to. The tightest ring with
      // a plausible number of vertices is the urban part of the seat.
      let pick: [number, number][] | null = null;
      for (const ring of collectRings(feature.geometry?.coordinates)) {
        if (ring.length < 12) continue;
        if (!pick || ringArea(ring) < ringArea(pick)) pick = ring;
      }
      if (pick) {
        const lon = pick.reduce((sum, p) => sum + p[0], 0) / pick.length;
        const lat = pick.reduce((sum, p) => sum + p[1], 0) / pick.length;
        centres.set(normalizeElectorateName(name), { lat, lon });
      }
    }
  }
  return centres;
}

const ELECTORATE_CENTRES = loadElectorateCentres();

/** Where the mock puts a seat's places: inside its own boundary when known. */
function anchorFor(eNo: number): { town: string; lat: number; lon: number } {
  const fallback = PLACE_ANCHORS[(eNo - 1) % PLACE_ANCHORS.length]!;
  const electorate = MOCK_ELECTORATES[eNo - 1];
  const centre = electorate
    ? ELECTORATE_CENTRES.get(normalizeElectorateName(electorate.name))
    : undefined;
  return centre ? { ...centre, town: fallback.town } : fallback;
}

type MockVotingPlace = {
  id: number;
  /** The seat whose directory lists this place's result — where its votes count. */
  countsForNo: number;
  /** The general electorate the register files it under (`vp_e_no`). */
  vpENo: number;
  placeNo: number;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
};

/** The general electorates, which come first in the cycle's electorate list. */
const GENERAL_ELECTORATE_COUNT =
  MOCK_ELECTORATE_SETS[ELECTION_YEAR].general.length;

function buildVotingPlaces(): MockVotingPlace[] {
  const places: MockVotingPlace[] = [];

  MOCK_ELECTORATES.forEach((electorate, index) => {
    const eNo = index + 1;
    // Coordinates follow the seat's own area, so a Māori seat's places land
    // inside the polygon the map zooms to. The register number does not: no
    // place is ever registered against a Māori electorate, so those booths are
    // filed under a general one and read as `elsewhere` in production too.
    const anchor = anchorFor(eNo);
    const registeredIn =
      eNo > GENERAL_ELECTORATE_COUNT
        ? ((eNo - 1) % GENERAL_ELECTORATE_COUNT) + 1
        : eNo;

    for (let booth = 1; booth <= BOOTHS_PER_SEAT; booth++) {
      const seed = eNo * 100 + booth;
      const suffix = PLACE_SUFFIXES[seed % PLACE_SUFFIXES.length]!;
      const streetNo = 3 + Math.round(jitter(seed) * 240);
      const road = PLACE_ROADS[seed % PLACE_ROADS.length]!;
      places.push({
        id: seed,
        countsForNo: eNo,
        vpENo: registeredIn,
        placeNo: booth,
        name: `${electorate.name} ${suffix}`,
        address: `${electorate.name} ${suffix}, ${streetNo} ${road}, ${electorate.name}`,
        lat: anchor.lat + (jitter(seed + 7) - 0.5) * 0.05,
        lon: anchor.lon + (jitter(seed + 13) - 0.5) * 0.07,
      });
    }

    // An advance voting place that counts for this seat but stands in the next
    // general electorate along — the case the circle mark exists for.
    const neighbourNo = (registeredIn % GENERAL_ELECTORATE_COUNT) + 1;
    const neighbour = anchorFor(neighbourNo);
    const advanceSeed = eNo * 100 + 4;
    places.push({
      id: advanceSeed,
      countsForNo: eNo,
      vpENo: neighbourNo,
      placeNo: 4,
      name: `Advance Voting Place, ${MOCK_ELECTORATES[neighbourNo - 1]!.name}`,
      address: `Advance Voting Place, ${MOCK_ELECTORATES[neighbourNo - 1]!.name}`,
      lat: neighbour.lat + (jitter(advanceSeed) - 0.5) * 0.05,
      lon: neighbour.lon + (jitter(advanceSeed + 3) - 0.5) * 0.07,
    });

    // Mobile teams carry votes but were never anywhere to draw.
    const teamSeed = eNo * 100 + 11;
    places.push({
      id: teamSeed,
      countsForNo: eNo,
      vpENo: registeredIn,
      placeNo: 11,
      name: 'Mobile Team 1',
      address: `Mobile Team, Team 1, Taken in ${electorate.name} Electorate`,
      lat: null,
      lon: null,
    });
  });

  return places;
}

const MOCK_VOTING_PLACES = buildVotingPlaces();

/** The places that count towards a seat: its own booths, advance place, teams. */
function placesForSeat(eNo: number): MockVotingPlace[] {
  return MOCK_VOTING_PLACES.filter((place) => place.countsForNo === eNo);
}

/** Share of a seat's places whose count has landed at each stage. */
const STAGE_COUNTED_SHARE = [0.35, 0.65, 0.9, 1];

function placeCounted(place: MockVotingPlace, seatNo: number): boolean {
  const share = STAGE_COUNTED_SHARE[currentStage] ?? 1;
  // A place's position in the queue is fixed, so advancing the stage only ever
  // adds receipts — a place never un-counts.
  return jitter(place.id * 3 + seatNo) < share;
}

function placeReceivedAt(place: MockVotingPlace): string {
  const minute = 5 + Math.floor(jitter(place.id + 17) * 48);
  const hour = currentStage >= 2 ? 20 : 19;
  return `${POLLING_DATE}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function placeFileName(place: MockVotingPlace, seatNo: number): string {
  return `${String(seatNo).padStart(2, '0')}-${String(place.vpENo).padStart(2, '0')}${String(place.placeNo).padStart(3, '0')}.xml`;
}

function renderVotingPlacesXml(): string {
  const entries = MOCK_VOTING_PLACES.map(
    (place) => `  <votingplace vp_id="${place.id}" vp_e_no="${place.vpENo}">
    <vp_address>${escapeXml(place.address)}</vp_address>
    <vp_lat>${place.lat === null ? '' : place.lat.toFixed(4)}</vp_lat>
    <vp_lon>${place.lon === null ? '' : place.lon.toFixed(4)}</vp_lon>
  </votingplace>`
  ).join('\n');
  return `${xmlDeclaration()}\n<votingplaces>\n${entries}\n</votingplaces>\n`;
}

/** An Apache-style autoindex, which is what the live feed serves. */
function renderVotingPlaceListing(seatNo: number): string {
  const rows = placesForSeat(seatNo)
    .map((place) => {
      const file = placeFileName(place, seatNo);
      return `    <tr><td><a href="${file}">${file}</a></td><td>-</td><td>2.1K</td></tr>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html><head><title>Index of /e${String(seatNo).padStart(2, '0')}/votingplaces/</title></head>
<body><h1>Index of /e${String(seatNo).padStart(2, '0')}/votingplaces/</h1>
<table>
${rows}
</table></body></html>`;
}

function renderVotingPlaceResult(
  place: MockVotingPlace,
  seatNo: number
): string {
  const counted = placeCounted(place, seatNo);
  const issued = counted ? 120 + Math.round(jitter(place.id) * 900) : 0;
  return `${xmlDeclaration()}
<votingplace vp_id="${place.id}" vp_e_no="${place.vpENo}" e_no="${seatNo}" vp_no="${place.placeNo}" updated="${POLLING_DATE}T21:00:00">
  <time_received>${counted ? placeReceivedAt(place) : ''}</time_received>
  <statistics>
    <total_issued_ballot_papers>${issued}</total_issued_ballot_papers>
  </statistics>
</votingplace>
`;
}

/**
 * Serve XML with the headers a conditional client needs.
 *
 * The stage's `Last-Modified` is sent on every file and `If-Modified-Since` is
 * honoured, so a collector run against the mock exercises the same 304 path as
 * production: the stage is the mock's equivalent of "the Commission
 * republished", and asking between stages returns an empty 304.
 */
function sendXml(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string
) {
  const lastModified = new Date(stageUpdatedAt).toUTCString();
  const since = req.headers['if-modified-since'];
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  if (Number.isFinite(sinceMs) && sinceMs >= stageLastModifiedMs()) {
    res.writeHead(304, { 'Last-Modified': lastModified });
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Last-Modified': lastModified,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'POST' && path === '/advance') {
    setStage((currentStage + 1) % STAGES.length);
    const stage = STAGE_NAMES[currentStage];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stage, index: currentStage }));
    return;
  }

  if (req.method === 'POST' && path === '/reset') {
    setStage(0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stage: STAGE_NAMES[0], index: 0 }));
    return;
  }

  if (path === '/stage') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        stage: STAGE_NAMES[currentStage],
        index: currentStage,
        total: STAGES.length,
      })
    );
    return;
  }

  if (path === '/candidates.xml') {
    sendXml(req, res, renderCandidatesXml());
    return;
  }

  if (path === '/parties.xml') {
    sendXml(req, res, renderPartiesXml());
    return;
  }

  if (path === '/electorates.xml') {
    sendXml(req, res, renderElectoratesXml());
    return;
  }

  if (path === '/election.xml') {
    sendXml(req, res, renderElectionXml());
    return;
  }

  if (path === '/votingplaces.xml') {
    sendXml(req, res, renderVotingPlacesXml());
    return;
  }

  const listing = path.match(/^\/e(\d+)\/votingplaces\/$/);
  if (listing) {
    const seatNo = parseInt(listing[1], 10);
    if (!MOCK_ELECTORATES[seatNo - 1]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderVotingPlaceListing(seatNo));
    return;
  }

  const placeFile = path.match(
    /^\/e(\d+)\/votingplaces\/(\d{2,3})-(\d{2})(\d{3})\.xml$/
  );
  if (placeFile) {
    const seatNo = parseInt(placeFile[1], 10);
    const place = MOCK_VOTING_PLACES.find(
      (candidate) => placeFileName(candidate, seatNo) === path.split('/').pop()
    );
    if (!place || !MOCK_ELECTORATES[seatNo - 1]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    sendXml(req, res, renderVotingPlaceResult(place, seatNo));
    return;
  }

  const match = path.match(/^\/e(\d+)\/e\d+\.xml$/);
  if (match) {
    const eNo = parseInt(match[1], 10);
    const electorate = MOCK_ELECTORATES[eNo - 1];
    const results = electorate ? resultsMap.get(electorate.name) : undefined;
    if (!electorate || !results || !results[currentStage]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    sendXml(req, res, renderElectorateXml(results[currentStage], eNo));
    return;
  }

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex());
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  console.error(`Mock server failed on port ${PORT}:`, err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(
    `Mock XML election results server listening on http://localhost:${PORT}`
  );
  console.log(`Election cycle: ${ELECTION_YEAR}`);
  console.log(
    `Stage: ${STAGE_NAMES[currentStage]} (${currentStage + 1}/${STAGES.length})`
  );
  console.log(
    `${MOCK_ELECTORATES.length} electorates, ${candidates.length} candidates`
  );
  console.log(`Feed base URL: http://localhost:${PORT}/`);
  console.log(`Advance: curl -X POST http://localhost:${PORT}/advance`);

  if (autoStepMs && autoStepMs > 0) {
    autoStepTimer = setInterval(() => {
      setStage((currentStage + 1) % STAGES.length);
      console.log(
        `Auto-advanced to stage: ${STAGE_NAMES[currentStage]} (${currentStage + 1}/${STAGES.length})`
      );
    }, autoStepMs);
    console.log(`Auto-step enabled: advancing every ${autoStepMs}ms`);
  }
});

function shutdown() {
  if (autoStepTimer) clearInterval(autoStepTimer);
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export function stopMockServer(): void {
  if (autoStepTimer) clearInterval(autoStepTimer);
  server.close();
}

export { server };
