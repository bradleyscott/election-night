// Hold-back validation for the seat probability.
//
// Replays the 2023 count seat by seat from the archived per-voting-place results,
// scores the model at 20 checkpoints per seat, and reports Brier against the
// question the panel actually asks: "is the candidate leading now still ahead
// when the count ends?"
//
// The ordering is the one thing the archive cannot give us: `time_received` was
// rewritten by the official count, so no arrival order survives. We approximate
// the night by releasing votes cast away from home first (they are advance
// votes, counted from 9am and released after 7pm) and then the seat's own places
// in a fixed pseudo-random order. Votes cast *inside* a seat at an advance
// centre cannot be separated from booths, so this understates how advance-heavy
// the first hours really are.
//
//   node scripts/validate-seat-probability.mjs
//   node scripts/validate-seat-probability.mjs --year 2023 --checkpoints 24
//
// Requires `npm run build:core` first, and the archive cache that
// `scripts/build-notional-baseline.mjs` writes to
// `.cache/notional-<year>-files-v2.json` (override with `--cache=<path>`).
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeSeatChance,
  cycleConstantsFor,
} from '../packages/core/dist/seat-probability.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ??
  fallback;

const YEAR = arg('year', '2023');
const CHECKPOINTS = Number(arg('checkpoints', '20'));
const STRENGTHS = arg('strengths', '0,0.5,1,1.5,2').split(',').map(Number);

const CACHE = arg('cache', `${ROOT}/.cache/notional-${YEAR}-files-v2.json`);
const BASELINE = `${ROOT}/packages/core/data/notional-baseline-${YEAR}.json`;

/** Read a JSON file, or say what is missing and how to produce it. */
async function readJson(path, hint) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.error(`could not read ${path}: ${err.message}`);
    console.error(hint);
    process.exit(1);
  }
}

// The builder's cache maps each archived result URL to its parsed body (or to
// null for a 404), which is exactly the per-place record this replay needs.
const placeCache = await readJson(
  CACHE,
  'Build it with: node scripts/build-notional-baseline.mjs (it caches the archive under .cache/), or pass --cache=<path>.'
);
const baseline = await readJson(
  BASELINE,
  'Regenerate it with: node scripts/build-notional-baseline.mjs'
);

// Turnout and the night share are per cycle; reading the 2023 duplicates here
// would validate a model the app no longer runs.
const cycle = cycleConstantsFor(Number(YEAR));

const seats = Object.entries(baseline.seats);
const tau = (baseline.tau.sdSwingDeviation ?? 6.8) / 100;

// Deterministic shuffle: the arrival order of a seat's own places is unknown, but
// two runs of this script must agree.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seededOrder(list, key) {
  return [...list].sort(
    (a, b) => hash(`${key}:${a.vpId}`) - hash(`${key}:${b.vpId}`)
  );
}

const partiesOf = (record) => Object.entries(record.partyVotes ?? {});
const sumVotes = (records) =>
  records.reduce((s, r) => s + partiesOf(r).reduce((a, [, v]) => a + v, 0), 0);

// Build the per-seat replay up front: an ordered list of places, plus running
// cumulative vote totals per party at each checkpoint.
const replays = [];
const records = Object.values(placeCache).filter(Boolean);

// e_no -> electorate name, straight from the archive, so the validator does not
// need the baseline to carry archival seat ids.
const electoratesXml = await fetch(
  `https://archive.electionresults.govt.nz/electionresults_${YEAR}/xml/electorates.xml`,
  { headers: { 'user-agent': 'election-night-validator/1.0' } }
).then((r) => r.text());

const nameByENo = new Map();
for (const match of electoratesXml.matchAll(
  /<electorate\b[^>]*\be_no="(\d+)"[^>]*>([\s\S]*?)<\/electorate>/g
)) {
  const name = /<electorate_name>([^<]*)<\/electorate_name>/.exec(
    match[2]
  )?.[1];
  if (name) nameByENo.set(Number(match[1]), name.trim());
}
if (nameByENo.size === 0) {
  console.error('could not read e_no -> name from electorates.xml');
  process.exit(1);
}

const bySeat = new Map();
for (const record of records) {
  const list = bySeat.get(record.eNo) ?? [];
  list.push(record);
  bySeat.set(record.eNo, list);
}

for (const [seatName, seat] of seats) {
  const eNo = [...nameByENo.entries()].find(
    ([, name]) => name === seatName
  )?.[0];
  if (!eNo) continue;
  const places = bySeat.get(eNo) ?? [];
  if (places.length === 0) continue;
  const away = seededOrder(
    places.filter((p) => p.vpENo !== eNo),
    `${YEAR}:${seatName}:away`
  );
  const home = seededOrder(
    places.filter((p) => p.vpENo === eNo),
    `${YEAR}:${seatName}:home`
  );
  const ordered = [...away, ...home];
  const total = sumVotes(ordered);
  if (total <= 0) continue;
  replays.push({
    seatName,
    eNo,
    ordered,
    total,
    prior: {
      partyShare: seat.partyShare,
      candidateShare: seat.candidateShare ?? {},
      partyCandidateShare: seat.partyCandidateShare ?? {},
    },
  });
}

console.log(
  `${replays.length} seats replayed from ${records.length} archived place results\n`
);

// Party-level candidates: the archive gives us party votes per place, not
// candidate votes, so the seat is treated as a party contest. That is a fair
// test of the weighting, which is what this harness exists to compare.
function countedAt(replay, fraction) {
  const target = replay.total * fraction;
  const counts = new Map();
  let used = 0;
  for (const place of replay.ordered) {
    for (const [party, votes] of partiesOf(place)) {
      counts.set(party, (counts.get(party) ?? 0) + votes);
    }
    used += partiesOf(place).reduce((a, [, v]) => a + v, 0);
    if (used >= target) break;
  }
  return { counts, used };
}

const fractions = Array.from(
  { length: CHECKPOINTS },
  (_, i) => (i + 1) / CHECKPOINTS
);

// Final leader per seat, decided on the whole count.
const finalLeaders = new Map();
for (const replay of replays) {
  const { counts } = countedAt(replay, 1);
  const [leader] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  finalLeaders.set(replay.seatName, leader?.[0]);
}

const scores = new Map(STRENGTHS.map((s) => [s, []]));
const naive = [];
const detail = [];

for (const fraction of fractions) {
  // One national picture per checkpoint, so every seat sees the same swing.
  const perSeat = replays.map((replay) => countedAt(replay, fraction));
  const swing = {};
  let swingWeight = 0;
  const swingDelta = new Map();
  replays.forEach((replay, i) => {
    const { counts, used } = perSeat[i];
    if (!used) return;
    for (const [party, votes] of counts) {
      const observed = votes / used;
      const prior =
        replay.prior.partyCandidateShare?.[party] ??
        replay.prior.partyShare?.[party] ??
        0;
      const entry = swingDelta.get(party) ?? { sum: 0, weight: 0 };
      entry.sum += (observed - prior) * used;
      entry.weight += used;
      swingDelta.set(party, entry);
    }
    swingWeight += used;
  });
  void swingWeight;
  for (const [party, { sum, weight }] of swingDelta) {
    if (weight > 0) swing[party] = sum / weight;
  }

  replays.forEach((replay, i) => {
    const { counts, used } = perSeat[i];
    if (used <= 0) return;
    const candidates = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([party, votes]) => ({ name: party, party, votes }));
    if (candidates.length < 2) return;

    const nightTotal = replay.total * cycle.nightShare;
    const progress = used / nightTotal;
    if (progress >= 0.99 || progress < 0.02) return;

    // Turnout the way the feed reports it: counted votes over enrolment.
    const percentVotesCast = fraction * cycle.turnout;
    const leaderNow = candidates[0].name;
    const outcome = finalLeaders.get(replay.seatName);
    const y = leaderNow === outcome ? 1 : 0;
    naive.push([1, y, progress]);
    const row = {
      seat: replay.seatName,
      progress,
      y,
      leader: leaderNow,
      probs: {},
    };

    for (const strength of STRENGTHS) {
      const chance = computeSeatChance({
        candidates,
        votesCounted: used,
        percentVotesCast,
        prior: replay.prior,
        nationalSwing: swing,
        tau,
        composition: strength,
      });
      if (chance.state !== 'counting') continue;
      scores.get(strength).push([chance.probability, y, progress]);
      row.probs[strength] = chance.probability;
    }
    detail.push(row);
  });
}

const brier = (pairs) =>
  pairs.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / (pairs.length || 1);
const confident = (pairs) => pairs.filter(([p]) => p >= 0.95).length;
const falseConfidence = (pairs) =>
  pairs.filter(([p, y]) => p >= 0.95 && y === 0).length;
const flips = (pairs) => pairs.filter(([, y]) => y === 0).length;
const meanPOnFlips = (pairs) => {
  const flipped = pairs.filter(([, y]) => y === 0);
  return flipped.reduce((s, [p]) => s + p, 0) / (flipped.length || 1);
};

const byBand = (pairs, early) =>
  pairs.filter(([, , progress]) => (early ? progress < 0.5 : progress >= 0.5));

console.log(
  'strength   Brier    early     late   on flips   ≥95% calls   wrong   n'
);
for (const strength of STRENGTHS) {
  const pairs = scores.get(strength) ?? [];
  console.log(
    `${String(strength).padStart(6)}   ${brier(pairs).toFixed(4)}   ${brier(byBand(pairs, true)).toFixed(4)}   ` +
      `${brier(byBand(pairs, false)).toFixed(4)}    ${meanPOnFlips(pairs).toFixed(3)}      ` +
      `${String(confident(pairs)).padStart(6)}   ${String(falseConfidence(pairs)).padStart(6)}   ${pairs.length}`
  );
}
console.log(
  `${'naive'.padStart(6)}   ${brier(naive).toFixed(4)}   ${brier(byBand(naive, true)).toFixed(4)}   ` +
    `${brier(byBand(naive, false)).toFixed(4)}    ${'-'.padStart(9)}      ` +
    `${String(naive.length).padStart(6)}   ${String(flips(naive)).padStart(6)}   ${naive.length}`
);
console.log(
  `\n${flips(naive)} of ${naive.length} checkpoints ended with the leader at that point losing the seat.`
);

const flipped = detail.filter((row) => row.y === 0);
if (flipped.length > 0) {
  console.log(
    '\ncheckpoints where the leader at that point did not win the seat:\n'
  );
  console.log(
    'seat                       progress   leader then           p(s=0)   p(s=1)'
  );
  for (const row of flipped.sort((a, b) => a.seat.localeCompare(b.seat))) {
    console.log(
      `${row.seat.padEnd(26)} ${row.progress.toFixed(2).padStart(6)}   ${row.leader.slice(0, 22).padEnd(22)} ` +
        `${(row.probs[0] ?? NaN).toFixed(3).padStart(6)}   ${(row.probs[1] ?? NaN).toFixed(3).padStart(6)}`
    );
  }
}
