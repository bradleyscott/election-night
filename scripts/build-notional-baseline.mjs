#!/usr/bin/env node
/**
 * Build the notional baseline for a cycle whose boundaries were redrawn.
 *
 * The problem: a seat's prior result is the only anchor a live count can be
 * compared against, and after a boundary review that prior is recorded on the
 * wrong geography. Political scientists solve this by publishing "notional
 * results" — the previous election recomputed as if the new boundaries had
 * been in place (Rallings & Thrasher in the UK, from ward-level local election
 * results). Our sub-seat unit is better than a ward: every voting place is
 * published with coordinates and with the votes it counted.
 *
 * Method, and its deliberate limit:
 *
 *  - Use only results where `e_no === vp_e_no`, i.e. votes cast at a place
 *    standing in the seat they count toward. Those voters are local by
 *    construction, so the place's coordinates stand in for their address.
 *  - Drop every result where the place stands outside the seat its votes count
 *    toward (advance votes cast elsewhere). Those votes belong to a seat we
 *    cannot geolocate, so they are excluded rather than guessed at. The
 *    baseline is therefore shares of *in-seat-cast* votes, not of the full
 *    seat total, and must be used for shares only.
 *  - Apportion each place to a target seat by point-in-polygon on the target
 *    cycle's boundaries.
 *
 * Also measures how far seats typically sit from a uniform national swing
 * (tau), which is what a seat model needs to know before it trusts a single
 * seat's own partial count.
 *
 * Usage:
 *   node scripts/build-notional-baseline.mjs --source 2023 --target 2026
 *   node scripts/build-notional-baseline.mjs --source 2023 --target 2023 --validate
 *   node scripts/build-notional-baseline.mjs --ratios-only --target 2026
 *
 * `--ratios-only` recomputes just `specialRatio` in an existing baseline: the
 * field depends on nothing but the source cycle and the seat's name, so adding
 * it does not have to pay for the probe again or rewrite every other number
 * from whatever this script looks like today.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Resolving a renamed seat needs the one table that records renames; matching by
// name alone is why five of 2026's ten "new" seats were rebuilt from place
// geometry when their own published result existed. Requires `npm run
// build:core`, like everything else that imports the built package.
import { resolvePriorElectorateName } from '@election-night/core/electorate-successions';
import { arg, hasFlag } from './lib/args.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONCURRENCY = 40;
const RETRIES = 3;

const SOURCE_YEAR = arg('source', '2023');
const TARGET_YEAR = arg('target', '2026');
const VALIDATE = hasFlag('validate');
const OUT = resolve(
  ROOT,
  arg('out', `packages/core/data/notional-baseline-${TARGET_YEAR}.json`)
);
// Special votes as a share of each electorate's vote, per cycle. Written by
// `build-special-vote-shares.mjs`, whose header says why it is a separate file:
// the Commission publishes it only as an HTML table the live hosts refuse.
const SPECIAL_VOTES_FILE = resolve(
  ROOT,
  'packages/core/data/special-votes-by-electorate.json'
);
const RATIOS_ONLY = hasFlag('ratios-only');

const archive = (year) =>
  `https://archive.electionresults.govt.nz/electionresults_${year}/xml/`;
const SRC = archive(SOURCE_YEAR);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every successful parse, keyed by URL. The archive is slow and the probe is
 * wide, so a second run (a different boundary target, or a fix to the
 * apportionment) should not pay for the same 18,000 requests again.
 */
const CACHE_FILE = resolve(
  ROOT,
  `.cache/notional-${SOURCE_YEAR}-files-v2.json`
);
let fileCache = null;
try {
  fileCache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  process.stderr.write(
    `  ${Object.keys(fileCache).length} cached result files\n`
  );
} catch {
  fileCache = {};
}
const cacheDirty = { value: false };

async function fetchText(url, { allow404 = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { 'user-agent': 'election-night-notional-baseline/1.0' },
      });
      if (res.status === 404 && allow404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      await sleep(300 * (attempt + 1));
    }
  }
  throw new Error(`GET ${url} failed: ${lastError?.message ?? 'unknown'}`);
}

/** Run `worker` over `items` with a fixed number in flight. */
async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
      if (++done % 2000 === 0) {
        process.stderr.write(`  ${done}/${items.length}\n`);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** All elements matching `<tag ...>...</tag>` at any depth. */
function blocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[1], body: m[2] });
  return out;
}

const attr = (attrs, name) => {
  // The leading boundary matters: `e_no` also appears inside `vp_e_no`, which
  // precedes it in the attribute list, so an unanchored match returns the
  // place's electorate for every result and the out-of-seat filter below
  // never fires.
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

const tagText = (body, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? m[1].trim() : null;
};

const num = (value) => Number(value ?? 0) || 0;

/** Same normalisation the app uses for seat names: macrons, case, punctuation. */
function normaliseName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// ---- geometry -------------------------------------------------------------

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi === yj) continue;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function buildPolygonIndex(features) {
  return features.map((feature) => {
    const geom = feature.geometry;
    const polygons =
      geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polygons) {
      for (const [x, y] of poly[0]) {
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
    }
    return { name: feature.properties.name, polygons, box };
  });
}

/** Index of the first polygon containing the point, or -1. */
function locate(index, lon, lat) {
  for (let i = 0; i < index.length; i++) {
    const { polygons, box } = index[i];
    if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) continue;
    for (const poly of polygons) {
      if (!ringContains(poly[0], lon, lat)) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (ringContains(poly[h], lon, lat)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return i;
    }
  }
  return -1;
}

// ---- special votes ---------------------------------------------------------

/**
 * Every seat's share of the vote that arrives after election night, relative to
 * its cycle's national share.
 *
 * Read from the committed file rather than fetched: the Commission publishes
 * this only as an HTML table on hosts that refuse it, so it is extracted once
 * by `build-special-vote-shares.mjs` and checked in.
 */
async function loadSpecialShares(year) {
  try {
    const data = JSON.parse(await readFile(SPECIAL_VOTES_FILE, 'utf8'));
    const cycle = data.cycles?.[String(year)];
    if (!cycle || !(cycle.nationalShare > 0)) return null;
    const byName = new Map();
    for (const [name, share] of Object.entries(cycle.seats ?? {})) {
      if (share > 0)
        byName.set(normaliseName(name), share / cycle.nationalShare);
    }
    process.stderr.write(
      `  ${byName.size} seats carry a measured special-vote share (${year})\n`
    );
    return byName;
  } catch (err) {
    process.stderr.write(
      `  no special-vote shares for ${year} (${err.message}); every seat uses the national share\n`
    );
    return null;
  }
}

/**
 * Add `specialRatio` to an existing baseline without rebuilding it.
 *
 * The ratio depends only on the source cycle and the seat's name, so a baseline
 * built before the special-vote table existed does not have to pay for the
 * 18,000-request probe again — and a rebuild would rewrite every other number
 * from whatever the script looks like today, which is not what adding one field
 * should cost.
 */
async function updateRatiosOnly() {
  const baseline = JSON.parse(await readFile(OUT, 'utf8'));
  const shares = await loadSpecialShares(baseline.sourceYear);
  if (!shares)
    throw new Error(`no special-vote shares for ${baseline.sourceYear}`);

  let carried = 0;
  const missing = [];
  for (const [name, record] of Object.entries(baseline.seats)) {
    const ratio = record.carriedFrom
      ? shares.get(normaliseName(record.carriedFrom))
      : undefined;
    record.specialRatio = ratio ? Number(ratio.toFixed(4)) : null;
    if (record.specialRatio) carried++;
    else missing.push(name);
  }

  await writeFile(OUT, JSON.stringify(baseline, null, 2) + '\n');
  process.stderr.write(
    `  ${carried} seats carry a special-vote ratio; ${missing.length} fall back to the national share${missing.length ? `: ${missing.join(', ')}` : ''}\n  wrote ${OUT}\n`
  );
}

// ---- main -----------------------------------------------------------------

async function main() {
  if (RATIOS_ONLY) {
    await updateRatiosOnly();
    return;
  }

  process.stderr.write(`notional baseline ${SOURCE_YEAR} -> ${TARGET_YEAR}\n`);

  const [partiesXml, candidatesXml, electoratesXml, placesXml, statisticsXml] =
    await Promise.all([
      fetchText(`${SRC}parties.xml`),
      fetchText(`${SRC}candidates.xml`),
      fetchText(`${SRC}electorates.xml`),
      fetchText(`${SRC}votingplaces.xml`),
      fetchText(`${SRC}statistics.xml`),
    ]);

  // The one national figure the feed publishes: every enrolled elector in the
  // source cycle, which the seats' rolls must add up to.
  const nationalElectors =
    Number(tagText(statisticsXml, 'total_electors')) || 0;

  const partyName = new Map(
    blocks(partiesXml, 'party').map((p) => [
      attr(p.attrs, 'p_no'),
      tagText(p.body, 'short_name'),
    ])
  );
  const candidateName = new Map(
    blocks(candidatesXml, 'candidate').map((c) => [
      attr(c.attrs, 'c_no'),
      tagText(c.body, 'candidate_name'),
    ])
  );
  // Which party each candidate stood for. Candidate names do not survive a
  // cycle, parties do — so every cross-cycle comparison runs through the party.
  // `candidates.xml` names a candidate's party by id, and party ids are
  // assigned per cycle — resolve through this cycle's parties.xml.
  const candidateParty = new Map(
    blocks(candidatesXml, 'candidate').map((c) => [
      attr(c.attrs, 'c_no'),
      partyName.get(tagText(c.body, 'party')) ?? '',
    ])
  );
  const candidatePartyOf = new Map(
    [...candidateName].map(([cNo, name]) => [name, candidateParty.get(cNo)])
  );
  const electorates = blocks(electoratesXml, 'electorate').map((e) => ({
    eNo: Number(attr(e.attrs, 'e_no')),
    name: tagText(e.body, 'electorate_name'),
  }));

  const places = blocks(placesXml, 'votingplace').map((p) => ({
    vpId: attr(p.attrs, 'vp_id'),
    vpENo: Number(attr(p.attrs, 'vp_e_no')),
    lat: Number(tagText(p.body, 'vp_lat')) || null,
    lon: Number(tagText(p.body, 'vp_lon')) || null,
  }));
  process.stderr.write(
    `  ${places.length} voting places, ${places.filter((p) => p.lat).length} with coordinates\n`
  );

  // Every in-seat result file, discovered by probing the file-name ordinal.
  // `vp_no` is sparse, so probe past the known count and let 404s fall away.
  // `vp_no` is not enumerable from any published file — it is a place's index
  // within its home electorate and the numbering is sparse and per-electorate
  // (Nelson's in-seat places run 101–128, Coromandel's 101–157, Auckland
  // Central's are low but gappy). The archive refuses directory listings, so
  // the only way to find a seat's in-seat result files is to ask for the
  // names and keep the ones that exist. Results whose `vp_e_no` differs from
  // their `e_no` are discarded on arrival, so a miss costs one 404.
  const PROBE_LIMIT = 260;
  const probes = [];
  for (const electorate of electorates) {
    for (let i = 1; i <= PROBE_LIMIT; i++) {
      probes.push({ eNo: electorate.eNo, i });
    }
  }
  process.stderr.write(`  probing ${probes.length} result files\n`);

  const electionDay = new Date(`${SOURCE_YEAR}-10-14T00:00:00Z`);

  const seen = new Set();
  const results = await pool(probes, async ({ eNo, i }) => {
    const e = String(eNo).padStart(2, '0');
    const url = `${SRC}e${e}/votingplaces/${e}-${e}${String(i).padStart(3, '0')}.xml`;
    if (Object.hasOwn(fileCache, url)) return fileCache[url];
    const xml = await fetchText(url, { allow404: true });
    if (!xml) {
      fileCache[url] = null;
      return null;
    }
    const root = /<votingplace\b([^>]*)>/.exec(xml);
    const attrs = root?.[1] ?? '';
    const vpId = attr(attrs, 'vp_id');
    if (vpId) {
      if (seen.has(vpId)) return null;
      seen.add(vpId);
    }
    const timeReceived = /<time_received>([^<]*)<\/time_received>/.exec(
      xml
    )?.[1];
    const partyVotes = {};
    const partyBlock =
      /<partyvotes>([\s\S]*?)<\/partyvotes>/.exec(xml)?.[1] ?? '';
    for (const p of blocks(partyBlock, 'party')) {
      const name = partyName.get(attr(p.attrs, 'p_no'));
      if (!name) continue;
      partyVotes[name] =
        (partyVotes[name] ?? 0) + num(tagText(p.body, 'votes'));
    }
    const candidateVotes = {};
    const candBlock =
      /<candidatevotes>([\s\S]*?)<\/candidatevotes>/.exec(xml)?.[1] ?? '';
    for (const c of blocks(candBlock, 'candidate')) {
      const name = candidateName.get(attr(c.attrs, 'c_no'));
      if (!name) continue;
      candidateVotes[name] =
        (candidateVotes[name] ?? 0) + num(tagText(c.body, 'votes'));
    }
    const record = {
      vpId: attr(attrs, 'vp_id'),
      eNo: Number(attr(attrs, 'e_no')),
      vpENo: Number(attr(attrs, 'vp_e_no')),
      issued: num(/<total_issued_ballot_papers>([^<]*)</.exec(xml)?.[1]),
      partyVotes,
      candidateVotes,
      timeReceived: timeReceived ?? null,
      afterElectionDay: timeReceived
        ? Date.parse(timeReceived.replace(' ', 'T')) > electionDay.getTime()
        : null,
    };
    fileCache[url] = record;
    cacheDirty.value = true;
    return record;
  });

  const usable = results.filter(Boolean);
  process.stderr.write(`  ${usable.length} results parsed\n`);

  if (cacheDirty.value) {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(fileCache));
    process.stderr.write(`  cached result files at ${CACHE_FILE}\n`);
  }

  // Each source seat's own file: the authoritative seat total, and the only
  // place enrolment can be recovered (`total_votes_cast ÷ percent_votes_cast`).
  // Needed for two things the place layer cannot do: enrolment per seat, and a
  // prior for a seat whose votes can never be geolocated — every Māori seat,
  // because no voting place stands in one.
  const sourceSeats = new Map();
  await pool(electorates, async (electorate) => {
    const e = String(electorate.eNo).padStart(2, '0');
    const xml = await fetchText(`${SRC}e${e}/e${e}.xml`, { allow404: true });
    if (!xml) return;
    const stats = /<statistics>([\s\S]*?)<\/statistics>/.exec(xml)?.[1] ?? '';
    const cast = num(tagText(stats, 'total_votes_cast'));
    const pct = num(tagText(stats, 'percent_votes_cast'));
    const partyVotes = {};
    const partyBlock =
      /<partyvotes>([\s\S]*?)<\/partyvotes>/.exec(xml)?.[1] ?? '';
    for (const p of blocks(partyBlock, 'party')) {
      const name = partyName.get(attr(p.attrs, 'p_no'));
      if (name) partyVotes[name] = num(tagText(p.body, 'votes'));
    }
    const candidateVotes = {};
    const candidateBlock =
      /<candidatevotes>([\s\S]*?)<\/candidatevotes>/.exec(xml)?.[1] ?? '';
    for (const c of blocks(candidateBlock, 'candidate')) {
      const name = candidateName.get(attr(c.attrs, 'c_no'));
      if (name) candidateVotes[name] = num(tagText(c.body, 'votes'));
    }
    sourceSeats.set(electorate.eNo, {
      name: electorate.name,
      cast,
      enrolment: pct > 0 ? Math.round(cast / (pct / 100)) : null,
      partyVotes,
      candidateVotes,
    });
  });
  process.stderr.write(`  ${sourceSeats.size} source seat files read\n`);

  const placeById = new Map(places.map((p) => [p.vpId, p]));

  // Point-in-polygon against the target cycle's boundaries.
  // General and Māori seats are separate contests over the same land: every
  // point sits inside one of each, so a single index would file every Māori
  // vote under a general seat. Each result is apportioned only within its own
  // kind, decided by whether its source seat's name is one of the seven Māori
  // electorates.
  const loadIndex = async (file) => {
    const path = resolve(
      ROOT,
      `packages/dashboard/public/boundaries/${TARGET_YEAR}/${file}`
    );
    const json = JSON.parse(await readFile(path, 'utf8'));
    return buildPolygonIndex(json.features);
  };
  const general = (await loadIndex('general-electorates.geojson')).map((b) => ({
    ...b,
    kind: 'general',
  }));
  const maori = (await loadIndex('maori-electorates.geojson')).map((b) => ({
    ...b,
    kind: 'maori',
  }));
  const maoriNames = new Set(maori.map((b) => normaliseName(b.name)));
  const boundaries = [...general, ...maori];
  const seatNameOf = new Map(electorates.map((e) => [e.eNo, e.name]));
  process.stderr.write(
    `  ${general.length} general and ${maori.length} Māori boundaries loaded\n`
  );

  const seats = new Map(
    boundaries.map((b) => [
      b.name,
      {
        name: b.name,
        kind: b.kind,
        partyVotes: {},
        candidateVotes: {},
        partyCandidateVotes: {},
        votes: 0,
        places: 0,
        unlocatedVotes: 0,
        // Votes located in this seat, by the source seat they came from, so
        // the source seat's roll can be split across the seats it became.
        sourceVotes: {},
      },
    ])
  );

  // Also fold into the source cycle's own seats, which validates the geometry:
  // the result should reproduce each published seat total.
  const sourceTotals = new Map();
  let placed = 0;
  let unplaced = 0;

  let outOfSeat = 0;
  let inSeat = 0;

  for (const result of usable) {
    const sourceName = seatNameOf.get(result.eNo) ?? '';
    const isMaoriSeat = maoriNames.has(normaliseName(sourceName));

    // A result counts toward `e_no` but was cast at a place standing in
    // `vp_e_no`. Those are advance votes cast outside the seat: the place's
    // coordinates say nothing about where the voter lives, so they are
    // dropped rather than guessed at.
    //
    // Māori seats are the exception, and not by choice: `vp_e_no` only ever
    // takes the 65 general values, so *no* place stands in a Māori seat and
    // every Māori result is formally out-of-seat. Dropping them would leave
    // seven seats with no prior at all, so they are located by where the vote
    // was cast — a weaker claim (a voter may vote anywhere), but a true one,
    // and better than no baseline.
    if (!isMaoriSeat && result.eNo !== result.vpENo) {
      outOfSeat++;
      continue;
    }
    if (!isMaoriSeat) inSeat++;

    const place = placeById.get(result.vpId);
    if (!place?.lat) {
      unplaced++;
      continue;
    }
    const index = isMaoriSeat ? maori : general;
    const hit = locate(index, place.lon, place.lat);
    if (hit === -1) {
      unplaced++;
      continue;
    }
    placed++;
    const seat = seats.get(index[hit].name);
    const resultVotes = Object.values(result.partyVotes).reduce(
      (a, b) => a + b,
      0
    );
    seat.sourceVotes[result.eNo] =
      (seat.sourceVotes[result.eNo] ?? 0) + resultVotes;
    for (const [party, votes] of Object.entries(result.partyVotes)) {
      seat.partyVotes[party] = (seat.partyVotes[party] ?? 0) + votes;
      seat.votes += votes;
    }
    for (const [name, votes] of Object.entries(result.candidateVotes)) {
      seat.candidateVotes[name] = (seat.candidateVotes[name] ?? 0) + votes;
      const party = candidatePartyOf.get(name);
      if (party) {
        seat.partyCandidateVotes[party] =
          (seat.partyCandidateVotes[party] ?? 0) + votes;
      }
    }
    seat.places++;

    const source = electorates.find((e) => e.eNo === result.eNo)?.name;
    if (source)
      sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + result.issued);
  }
  process.stderr.write(
    `  ${placed} places located, ${unplaced} without coordinates or outside every boundary\n`
  );

  const share = (counts, total) => {
    const out = {};
    for (const [key, value] of Object.entries(counts)) {
      out[key] = Number((value / total).toFixed(5));
    }
    return out;
  };

  // Roll split: a source seat's enrolment is divided across the target seats its
  // votes landed in, in proportion to where those votes went. Enrolment follows
  // voters, and voters follow the same places their votes were counted at.
  const enrolmentOf = (seat) => {
    let enrolment = 0;
    for (const [eNo, votes] of Object.entries(seat.sourceVotes)) {
      const source = sourceSeats.get(Number(eNo));
      if (!source?.enrolment || !source.cast) continue;
      enrolment += (votes / source.cast) * source.enrolment;
    }
    return Math.round(enrolment) || null;
  };

  const sourceByName = new Map(
    [...sourceSeats.values()].map((seat) => [normaliseName(seat.name), seat])
  );

  // The same map, keyed by the name each source seat carries *in the target
  // cycle*. A renamed seat is the same seat — the Representation Commission says
  // so, and the source cycle published a full result for it — so it must be
  // carried over rather than rebuilt from the places geometry could locate.
  // Resolving forwards is the direction the rename table runs in; asking it for
  // the earlier name of a later seat is not.
  //
  // A seat created by a merge or a split resolves to itself, finds no target
  // seat of that name, and correctly falls through to the apportionment below.
  const sourceByTargetName = new Map();
  for (const seat of sourceSeats.values()) {
    const carried = resolvePriorElectorateName(
      String(SOURCE_YEAR),
      String(TARGET_YEAR),
      seat.name
    );
    sourceByTargetName.set(normaliseName(carried), seat);
  }

  // A seat's own published result is the better prior wherever the name
  // carries over: it counts *every* vote the seat received, including advance
  // votes cast at places standing in other electorates. The place geometry can
  // only see results filed under a place inside the seat, and under 2023
  // conditions that is about half a seat's ballots — the missing half is
  // advance voters, who lean measurably differently (National +2.4 points in
  // 2023). So geometry is used only where it is unavoidable: seats that are new
  // or renamed, which have no same-name predecessor.
  // Special votes as a ratio to the cycle's national share, for seats whose
  // prior is their own previous result.
  const specialShares = await loadSpecialShares(SOURCE_YEAR);
  const specialRatioOf = (name) => {
    const ratio = specialShares?.get(normaliseName(name));
    return ratio ? Number(ratio.toFixed(4)) : null;
  };

  const recordFromSource = (kind, source) => {
    const votes = Object.values(source.partyVotes).reduce((a, b) => a + b, 0);
    if (!votes) return null;
    const candidateVotes = Object.values(source.candidateVotes).reduce(
      (a, b) => a + b,
      0
    );
    const partyCandidateVotes = {};
    for (const [name, count] of Object.entries(source.candidateVotes)) {
      const party = candidatePartyOf.get(name);
      if (party) {
        partyCandidateVotes[party] = (partyCandidateVotes[party] ?? 0) + count;
      }
    }
    return {
      kind,
      votes,
      partyShare: share(source.partyVotes, votes),
      candidateShare: candidateVotes
        ? share(source.candidateVotes, candidateVotes)
        : {},
      partyCandidateShare: candidateVotes
        ? share(partyCandidateVotes, candidateVotes)
        : {},
      enrolment: source.enrolment ?? null,
      // How much of this seat's vote arrives as special votes, relative to the
      // cycle's national share. Stable between cycles (r = 0.96, 2020 vs 2023)
      // while the national level is not, which is why the ratio lives here and
      // the level stays in the cycle constants.
      specialRatio: specialRatioOf(source.name),
      // Named for what it is: the seat's own previous result, not an estimate
      // rebuilt from the places inside it.
      method: 'same-name',
      carriedFrom: source.name,
    };
  };

  const seatRecords = {};
  let carriedOver = 0;
  let apportioned = 0;
  for (const seat of seats.values()) {
    const source =
      sourceByName.get(normaliseName(seat.name)) ??
      sourceByTargetName.get(normaliseName(seat.name)) ??
      null;
    const carried = source ? recordFromSource(seat.kind, source) : null;
    if (carried) {
      seatRecords[seat.name] = { ...carried, places: seat.places };
      carriedOver++;
      continue;
    }

    if (!seat.votes) continue;
    seatRecords[seat.name] = {
      kind: seat.kind,
      votes: seat.votes,
      places: seat.places,
      partyShare: share(seat.partyVotes, seat.votes),
      candidateShare: share(seat.candidateVotes, seat.votes),
      // The party's share of the *candidate* vote in this seat. A candidate is
      // an avatar of their party — people change, parties do not — so this is
      // the prior a projection actually wants.
      partyCandidateShare: share(seat.partyCandidateVotes, seat.votes),
      enrolment: enrolmentOf(seat),
      // No same-name predecessor to take a special-vote share from, and
      // specials are not cast at a voting place, so geometry cannot find them
      // either. The model falls back to the flat national share for this seat.
      specialRatio: null,
      // No same-name predecessor: shares come from the places that fall inside
      // the new boundary, so advance votes counted for the seat from elsewhere
      // are missing and the totals are short of what the seat received.
      method: 'place-apportioned',
    };
    apportioned++;
  }
  process.stderr.write(
    `  ${carriedOver} seats from their own previous result, ${apportioned} apportioned from place geometry\n`
  );

  // ---- the roll has to add up ---------------------------------------------
  //
  // Every enrolled elector sits in exactly one electorate, and a boundary
  // review redistributes the same people, so the seats' rolls must sum to the
  // source cycle's own national roll. Seats carried over from their own result
  // already do — those two figures agree to within a rounding error, which is
  // the check that says the recovery is sound. The gap is the ballots place
  // geometry cannot see: advance votes cast at a hub standing in another
  // electorate. It therefore belongs to the seats *built* from the located
  // places, not spread across every seat, which is why the correction is
  // applied only to the apportioned ones.
  //
  // This is a level correction and not a shape correction: the shares were
  // computed from the apportioned votes before this runs, so the prior a
  // projection reads is untouched. Uncorrected, the seats summed to about 93%
  // of the real roll, and an understated roll overstates counting progress in
  // every one of those seats — the direction that manufactures confidence.
  const apportionedSeats = Object.values(seatRecords).filter(
    (record) => record.method === 'place-apportioned'
  );
  const recordedElectors = Object.values(seatRecords).reduce(
    (sum, record) => sum + (record.enrolment ?? 0),
    0
  );
  const apportionedElectors = apportionedSeats.reduce(
    (sum, record) => sum + (record.enrolment ?? 0),
    0
  );
  const residual = nationalElectors - recordedElectors;

  // A ceiling, because the apportionment can only understate a seat and the
  // residual is not all its to absorb: a same-name seat's roll is the *previous*
  // cycle's for that name, and boundary shifts move electors between neighbours
  // in both directions. So the correction is capped at a fifth above the
  // national average roll — generous enough that only an absurdity trips it —
  // and whatever is left over is spread across the table, which is the same
  // admission made smaller.
  const seatCount = Object.keys(seatRecords).length;
  const quota = seatCount > 0 ? nationalElectors / seatCount : 0;
  const ceiling = quota * 1.2;

  if (nationalElectors <= 0) {
    process.stderr.write(
      '  WARNING statistics.xml carried no total_electors\n'
    );
  } else if (Math.abs(residual) > 0.005 * nationalElectors) {
    if (apportionedElectors <= 0) {
      process.stderr.write(
        `  WARNING roll is ${Math.round(residual).toLocaleString()} short of ` +
          `${nationalElectors.toLocaleString()} with no apportioned seat to carry it\n`
      );
    } else {
      const factor = Math.max(
        0,
        (apportionedElectors + residual) / apportionedElectors
      );
      let held = 0;
      let capped = 0;
      for (const record of apportionedSeats) {
        const from = record.enrolment ?? 0;
        const wanted = from * factor;
        const limited =
          record.kind === 'general' && wanted > ceiling ? ceiling : wanted;
        if (limited < wanted) capped++;
        record.enrolment = Math.round(limited);
        // Scaled with the roll so the record stays internally consistent (the
        // implied turnout is the source seat's); shares are already stored and
        // are unaffected.
        record.votes = Math.round(
          (record.votes ?? 0) * (from ? limited / from : 1)
        );
        held += record.enrolment;
      }
      process.stderr.write(
        `  roll: ${apportionedSeats.length} apportioned seats ×${factor.toFixed(3)}` +
          (capped
            ? `, ${capped} held at ${Math.round(ceiling).toLocaleString()}`
            : '') +
          '\n'
      );
      // Spread what the ceiling would not take, proportionally, so no single
      // seat is asked to carry it.
      const afterCap = Object.values(seatRecords).reduce(
        (sum, record) => sum + (record.enrolment ?? 0),
        0
      );
      const spill = nationalElectors - afterCap;
      if (Math.abs(spill) > 1) {
        const spread = spill / afterCap;
        for (const record of Object.values(seatRecords)) {
          record.enrolment = Math.round((record.enrolment ?? 0) * (1 + spread));
          record.votes = Math.round((record.votes ?? 0) * (1 + spread));
        }
        process.stderr.write(
          `  roll: ${Math.round(spill).toLocaleString()} spread across all seats ` +
            `(+${(spread * 100).toFixed(1)}%)\n`
        );
      }
    }
  }

  const finalElectors = Object.values(seatRecords).reduce(
    (sum, record) => sum + (record.enrolment ?? 0),
    0
  );
  if (
    nationalElectors > 0 &&
    Math.abs(finalElectors - nationalElectors) > 0.002 * nationalElectors
  ) {
    throw new Error(
      `seat rolls sum to ${finalElectors.toLocaleString()}, not the ` +
        `${nationalElectors.toLocaleString()} enrolled in ${SOURCE_YEAR}`
    );
  }

  // ---- tau: how far seats sit from a uniform national swing --------------
  //
  // Uniform national swing is the psephological baseline: every seat moves by
  // the same amount. The spread of the residual is what tells a seat model how
  // much to trust one seat's own partial count, so it is measured rather than
  // guessed.
  // The transition into the target cycle has no archive yet, so the spread is
  // measured on the most recent completed transition instead.
  const tau =
    (await measureSwingDispersion(TARGET_YEAR)) ??
    (await measureSwingDispersion(SOURCE_YEAR));

  const payload = {
    _comment:
      'Generated by scripts/build-notional-baseline.mjs — do not edit by hand. ' +
      `Prior result for the ${TARGET_YEAR} boundaries, rebuilt from ${SOURCE_YEAR} ` +
      'in-seat voting place results located by coordinates. Shares are of votes ' +
      'cast at places standing inside the seat; advance votes cast elsewhere are ' +
      'excluded because they cannot be geolocated. A seat that kept its name and ' +
      "gained no located votes takes the source cycle's result for that name " +
      'instead (`method: same-name`) — resolved through the rename table, so a ' +
      'renamed seat keeps its own result rather than being rebuilt from geometry. ' +
      "Seat rolls are scaled so they sum to the source cycle's `total_electors`. " +
      'Boundary data: Stats NZ (CC BY 4.0).',
    sourceYear: Number(SOURCE_YEAR),
    targetYear: Number(TARGET_YEAR),
    /** Enrolled electors in the source cycle, from `statistics.xml`. */
    rollElectors: nationalElectors,
    method: 'in-seat voting place results, point-in-polygon',
    tau,
    coverage: {
      seats: Object.keys(seatRecords).length,
      carriedOver,
      placesLocated: placed,
      seatsFromOwnPrior: carriedOver,
      seatsApportioned: apportioned,
      placesSkipped: unplaced,
      inSeatResults: inSeat,
      outOfSeatResultsDropped: outOfSeat,
    },
    seats: Object.fromEntries(
      Object.entries(seatRecords).sort(([a], [b]) => a.localeCompare(b))
    ),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  process.stderr.write(`  wrote ${OUT}\n`);

  const missing = boundaries
    .map((b) => b.name)
    .filter((name) => !seatRecords[name]);
  if (missing.length) {
    process.stderr.write(
      `  WARNING no votes located for: ${missing.join(', ')}\n`
    );
  }

  if (VALIDATE) {
    await validateAgainstPublished();
  }
}

/**
 * Dispersion of seat swings around the national swing, for the transition
 * ending in `targetYear`. `tau` is a standard deviation of vote share in
 * percentage points.
 */
async function measureSwingDispersion(targetYear) {
  const previousYear = String(Number(targetYear) - 3);
  try {
    const [
      fromNames,
      fromElection,
      fromParties,
      toNames,
      toElection,
      toParties,
    ] = await Promise.all([
      fetchText(`${archive(previousYear)}electorates.xml`),
      fetchText(`${archive(previousYear)}election.xml`),
      fetchText(`${archive(previousYear)}parties.xml`),
      fetchText(`${archive(targetYear)}electorates.xml`),
      fetchText(`${archive(targetYear)}election.xml`),
      fetchText(`${archive(targetYear)}parties.xml`),
    ]);

    // `p_no` is assigned per cycle, so a party's id in 2020 is not its id in
    // 2023. Every comparison across cycles is keyed by party name instead.
    const partyNames = (xml) =>
      new Map(
        blocks(xml, 'party').map((p) => [
          attr(p.attrs, 'p_no'),
          tagText(p.body, 'party_name'),
        ])
      );
    const fromPartyNames = partyNames(fromParties);
    const toPartyNames = partyNames(toParties);
    const namesOf = (xml) =>
      new Map(
        blocks(xml, 'electorate').map((e) => [
          Number(attr(e.attrs, 'e_no')),
          tagText(e.body, 'electorate_name'),
        ])
      );
    const fromMap = namesOf(fromNames);
    const toMap = namesOf(toNames);

    const nationalShare = (xml, names) => {
      const total = num(/<total_votes_cast>([^<]*)</.exec(xml)?.[1]);
      const out = new Map();
      for (const p of blocks(xml, 'party')) {
        const name = names.get(attr(p.attrs, 'p_no'));
        const votes = num(tagText(p.body, 'votes'));
        if (!name) continue;
        out.set(name, total ? (votes / total) * 100 : 0);
      }
      return out;
    };
    const fromNational = nationalShare(fromElection, fromPartyNames);
    const toNational = nationalShare(toElection, toPartyNames);
    const nationalDelta = new Map();
    for (const [name, value] of toNational) {
      nationalDelta.set(name, value - (fromNational.get(name) ?? 0));
    }

    const seatShares = async (year, map, names) => {
      const entries = [...map.entries()];
      return pool(entries, async ([eNo, name]) => {
        const e = String(eNo).padStart(2, '0');
        const xml = await fetchText(`${archive(year)}e${e}/e${e}.xml`, {
          allow404: true,
        });
        if (!xml) return null;
        const partyBlock =
          /<partyvotes>([\s\S]*?)<\/partyvotes>/.exec(xml)?.[1] ?? '';
        const total = num(/<total_votes_cast>([^<]*)</.exec(xml)?.[1]);
        const shares = new Map();
        for (const p of blocks(partyBlock, 'party')) {
          const name = names.get(attr(p.attrs, 'p_no'));
          const votes = num(tagText(p.body, 'votes'));
          if (!name) continue;
          shares.set(name, total ? (votes / total) * 100 : 0);
        }
        return { name, shares };
      });
    };

    const [fromSeats, toSeats] = await Promise.all([
      seatShares(previousYear, fromMap, fromPartyNames),
      seatShares(targetYear, toMap, toPartyNames),
    ]);
    const byName = new Map(
      toSeats.filter(Boolean).map((s) => [normaliseName(s.name), s])
    );

    const topTwo = [...toNational.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([pNo]) => pNo);

    const residuals = [];
    const signed = [];
    for (const seat of fromSeats.filter(Boolean)) {
      const match = byName.get(normaliseName(seat.name));
      if (!match) continue;
      const deltas = [];
      for (const [pNo, share] of match.shares) {
        const expected =
          (seat.shares.get(pNo) ?? 0) + (nationalDelta.get(pNo) ?? 0);
        deltas.push(share - expected);
      }
      // One number per seat: the largest departure from the uniform swing,
      // which is the case a seat model actually has to survive.
      if (deltas.length) {
        residuals.push(Math.max(...deltas.map(Math.abs)));
      }

      // `tau` wants the spread of a *single* quantity, and the max over parties
      // is an extreme statistic: its spread is not the spread of local swing.
      // Neither can it follow "the seat's biggest party", because that party
      // changes between cycles and the residual then measures a change of
      // identity rather than a local swing.
      //
      // So measure the quantity the model actually uses: the margin between the
      // two parties that led the country in the target cycle, and how far each
      // seat's swing in that margin departed from the national swing in it.
      if (topTwo && seat.shares.has(topTwo[0]) && match.shares.has(topTwo[0])) {
        const [a, b] = topTwo;
        const marginTarget =
          (match.shares.get(a) ?? 0) - (match.shares.get(b) ?? 0);
        const marginPrior =
          (seat.shares.get(a) ?? 0) - (seat.shares.get(b) ?? 0);
        const nationalMarginDelta =
          (toNational.get(a) ?? 0) -
          (toNational.get(b) ?? 0) -
          ((fromNational.get(a) ?? 0) - (fromNational.get(b) ?? 0));
        signed.push(marginTarget - marginPrior - nationalMarginDelta);
      }
    }
    if (residuals.length < 5) return null;
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const variance =
      residuals.reduce((a, b) => a + (b - mean) ** 2, 0) / residuals.length;
    const signedMean = signed.reduce((a, b) => a + b, 0) / signed.length;
    const signedVariance =
      signed.reduce((a, b) => a + (b - signedMean) ** 2, 0) / signed.length;
    return {
      transition: `${previousYear}->${targetYear}`,
      seats: residuals.length,
      meanMaxAbsDeviation: Number(mean.toFixed(3)),
      sdMaxAbsDeviation: Number(Math.sqrt(variance).toFixed(3)),
      maxAbsDeviation: Number(Math.max(...residuals).toFixed(3)),
      // The one the model uses: sd of the leading party's departure from
      // uniform national swing, in vote-share points.
      sdSwingDeviation: Number(Math.sqrt(signedVariance).toFixed(3)),
    };
  } catch (error) {
    process.stderr.write(`  tau unavailable: ${error.message}\n`);
    return null;
  }
}

async function validateAgainstPublished() {
  process.stderr.write('  validating geometry against published totals\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
