#!/usr/bin/env node
/**
 * Build the fixture the mock XML feed replays.
 *
 * The mock used to invent candidates and hand each electorate a randomly
 * assigned "pattern" of party support. That made every replay look the same
 * from seat to seat: a generic surname in Epsom and the same generic surname in
 * Māngere, with no relationship to how those seats actually vote. This script
 * reads the Commission's own results — the 2020 and 2023 archives and the live
 * 2026 media feed — and writes the candidates, party votes and candidate votes
 * the mock should replay.
 *
 * Nothing is generated at runtime. `packages/collector/src/mock-election-data.json`
 * is committed, so the mock stays offline and its output is reproducible.
 *
 * Usage:
 *   node scripts/build-mock-election-data.mjs
 *   node scripts/build-mock-election-data.mjs --year 2026
 *
 * Requires `npm run build:core` for the shared XML parser configuration.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { xmlParser, toArray } from '@election-night/core/xml';
import { normalizeElectorateName } from '@election-night/core/electorate-names';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'packages/collector/src/mock-election-data.json');
const CACHE = resolve(ROOT, '.cache/mock-election-data');

const yearArg = process.argv.indexOf('--year');
const ONLY_YEAR =
  yearArg === -1 ? null : (process.argv[yearArg + 1] ?? '').trim();

/**
 * The cycles the mock can replay. 2020 and 2023 are on the archive host; 2026
 * is the live media feed. 2020 and 2023 share the same electorate names, which
 * is why the mock declares 2020's electorates from the 2023 boundary set.
 */
const CYCLES = {
  2020: {
    baseUrl:
      'https://archive.electionresults.govt.nz/electionresults_2020/xml/',
    pollingDate: '2020-10-17',
  },
  2023: {
    baseUrl:
      'https://archive.electionresults.govt.nz/electionresults_2023/xml/',
    pollingDate: '2023-10-14',
  },
  2026: {
    baseUrl: 'https://media.election.net.nz/xml/',
    pollingDate: '2026-11-07',
  },
};

const MAORI_ELECTORATES = new Set(
  [
    'Hauraki-Waikato',
    'Ikaroa-Rāwhiti',
    'Tāmaki Makaurau',
    'Te Tai Hauāuru',
    'Te Tai Tokerau',
    'Te Tai Tonga',
    'Waiariki',
  ].map(normalizeElectorateName)
);

function isMaori(name) {
  return MAORI_ELECTORATES.has(normalizeElectorateName(name));
}

/** A body cached from a previous run, so re-running is cheap and offline. */
async function cachedFetch(url, cachePath) {
  try {
    return await readFile(cachePath, 'utf8');
  } catch {
    // not cached yet
  }

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          'user-agent': 'election-night-mock-data/1.0',
          accept: 'application/xml,text/xml,*/*',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, body);
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`GET ${url} failed: ${lastError?.message ?? 'unknown'}`);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseParties(xml) {
  const root = xmlParser.parse(xml)?.parties;
  return toArray(root?.party).map((p) => ({
    pNo: num(p.p_no),
    abbrev: String(p.abbrev ?? ''),
    name: String(p.short_name ?? ''),
    registered: String(p.registered ?? '').toLowerCase() === 'yes',
  }));
}

function parseElectorates(xml) {
  const root = xmlParser.parse(xml)?.electorates;
  return toArray(root?.electorate).map((e) => ({
    eNo: num(e.e_no),
    name: String(e.electorate_name ?? ''),
    kind: isMaori(String(e.electorate_name ?? '')) ? 'maori' : 'general',
  }));
}

function parseCandidates(xml) {
  const root = xmlParser.parse(xml)?.candidates;
  return toArray(root?.candidate).map((c) => ({
    cNo: num(c.c_no),
    // The 2023 archive marks the cancelled Port Waikato poll this way. The
    // mock replays an ordinary count, so the marker is noise (the seat itself
    // is filled in below, from the party vote).
    name: String(c.candidate_name ?? '').replace(
      /\s*\(poll cancelled\)\s*$/i,
      ''
    ),
    eNo: num(c.electorate),
    pNo: num(c.party),
    listNo: num(c.list_no),
  }));
}

function parseElectorateResult(xml) {
  const root = xmlParser.parse(xml)?.electorate;
  if (!root) throw new Error('electorate root not found');

  const stats = root.statistics ?? {};
  const votesCounted = num(stats.total_votes_cast);
  const percentVotesCast = num(stats.percent_votes_cast);
  return {
    votesCounted,
    enrolment:
      percentVotesCast > 0
        ? Math.round(votesCounted / (percentVotesCast / 100))
        : null,
    partyVotes: Object.fromEntries(
      toArray(root.partyvotes?.party).map((p) => [
        String(num(p.p_no)),
        num(p.votes),
      ])
    ),
    candidateVotes: Object.fromEntries(
      toArray(root.candidatevotes?.candidate).map((c) => [
        String(num(c.c_no)),
        num(c.votes),
      ])
    ),
  };
}

function parseElection(xml) {
  const root = xmlParser.parse(xml)?.election;
  if (!root) throw new Error('election root not found');

  const stats = root.statistics ?? {};
  return {
    totalVotesCast: num(stats.total_votes_cast),
    percentVotesCast: num(stats.percent_votes_cast),
    totalElectoratesFinal: num(stats.total_electorates_final),
    percentElectoratesFinal: num(stats.percent_electorates_final),
    totalMinimalVotes: num(stats.total_minimal_votes),
    totalSpecialVotes: num(stats.total_special_votes),
    parties: toArray(root.partystatus?.party).map((p) => ({
      pNo: num(p.p_no),
      votes: num(p.votes),
      percentVotes: num(p.percent_votes),
      listSeats: num(p.party_seats),
      electorateSeats: num(p.candidate_seats),
      totalSeats: num(p.total_seats),
    })),
  };
}

/**
 * The 2023 Port Waikato poll was cancelled after a candidate died. The archive
 * publishes the seat's party vote but writes zero for every candidate, which
 * would leave the mock unable to show a winner or a margin there. Reconstruct
 * candidate votes from the party vote so the seat behaves like the rest of the
 * feed; this is a fallback for a hole in the archive, not a claim about the
 * later by-election.
 */
function fillCancelledPollCandidateVotes(candidates, electorates, results) {
  const candidatesByElectorate = new Map();
  for (const candidate of candidates) {
    if (candidate.eNo === 0) continue;
    const list = candidatesByElectorate.get(candidate.eNo) ?? [];
    list.push(candidate);
    candidatesByElectorate.set(candidate.eNo, list);
  }

  for (const electorate of electorates) {
    const result = results[String(electorate.eNo)];
    const seated = candidatesByElectorate.get(electorate.eNo) ?? [];
    const candidateTotal = Object.values(result.candidateVotes).reduce(
      (sum, votes) => sum + votes,
      0
    );
    if (candidateTotal > 0 || seated.length === 0) continue;

    const partyTotal = Object.values(result.partyVotes).reduce(
      (sum, votes) => sum + votes,
      0
    );
    if (partyTotal <= 0) continue;

    for (const candidate of seated) {
      const partyVotes = result.partyVotes[String(candidate.pNo)] ?? 0;
      result.candidateVotes[String(candidate.cNo)] =
        candidate.pNo > 0
          ? Math.round((partyVotes / partyTotal) * result.votesCounted)
          : 0;
    }
  }
}

async function buildCycle(year, config) {
  const cacheDir = resolve(CACHE, year);
  const fetchFile = (path) =>
    cachedFetch(`${config.baseUrl}${path}`, resolve(cacheDir, path));

  const [partiesXml, electoratesXml, candidatesXml, electionXml] =
    await Promise.all([
      fetchFile('parties.xml'),
      fetchFile('electorates.xml'),
      fetchFile('candidates.xml'),
      fetchFile('election.xml'),
    ]);

  const parties = parseParties(partiesXml);
  const electorates = parseElectorates(electoratesXml);
  const candidates = parseCandidates(candidatesXml);

  const results = {};
  for (const electorate of electorates) {
    const padded = String(electorate.eNo).padStart(2, '0');
    const xml = await fetchFile(`e${padded}/e${padded}.xml`);
    results[String(electorate.eNo)] = parseElectorateResult(xml);
  }
  fillCancelledPollCandidateVotes(candidates, electorates, results);

  const partyByNo = new Map(parties.map((p) => [p.pNo, p]));
  const electorateByNo = new Map(electorates.map((e) => [e.eNo, e]));
  for (const candidate of candidates) {
    if (candidate.eNo !== 0 && !electorateByNo.has(candidate.eNo)) {
      throw new Error(
        `${year}: candidate ${candidate.cNo} (${candidate.name}) references unknown electorate ${candidate.eNo}`
      );
    }
    if (candidate.pNo !== 0 && !partyByNo.has(candidate.pNo)) {
      throw new Error(
        `${year}: candidate ${candidate.cNo} (${candidate.name}) references unknown party ${candidate.pNo}`
      );
    }
  }

  return {
    source: config.baseUrl,
    pollingDate: config.pollingDate,
    parties,
    electorates,
    candidates,
    results,
    election: parseElection(electionXml),
  };
}

const years = ONLY_YEAR ? [ONLY_YEAR] : Object.keys(CYCLES);
const cycles = {};

for (const year of years) {
  const config = CYCLES[year];
  if (!config) throw new Error(`Unknown year "${year}"`);
  process.stderr.write(`Building mock data for ${year}…\n`);
  cycles[year] = await buildCycle(year, config);
}

/**
 * A merged fixture, so `--year 2026` refreshes one cycle without discarding
 * the others. The first run writes all three.
 */
let previous = { cycles: {} };
try {
  previous = JSON.parse(await readFile(OUT, 'utf8'));
} catch {
  // first run
}

const merged = { ...previous.cycles, ...cycles };
const output = {
  _comment:
    'Generated by scripts/build-mock-election-data.mjs — do not edit by hand. ' +
    'Real candidates, party votes and candidate votes from the Electoral ' +
    "Commission's published results (2020 and 2023 archives, 2026 live media feed). " +
    'The mock scales these final totals into staged partial counts at runtime.',
  cycles: merged,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);

process.stderr.write(
  `Wrote ${OUT} (${Object.keys(merged).sort().join(', ')})\n`
);
