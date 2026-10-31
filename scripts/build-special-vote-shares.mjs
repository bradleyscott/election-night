#!/usr/bin/env node
/**
 * Special votes as a share of each electorate's vote, per cycle.
 *
 * The model needs to know how much of a seat's vote arrives after election
 * night, and the Commission publishes exactly that below the national total:
 * `party-sdv-by-electorate.html` carries every electorate's special declaration
 * votes (allowed, informal and disallowed) and the archived seat totals carry
 * the denominator.
 *
 * Why this is a script and not two URLs in the baseline builder: the live hosts
 * answer `/statistics/*.html` with a Cloudflare block while still serving
 * `/xml/*.xml`, so the table has to come through the Wayback Machine, which
 * rate-limits. Fetching it once, caching it, and committing the derived file
 * keeps `build-notional-baseline.mjs` free of that.
 *
 * Usage:
 *   node scripts/build-special-vote-shares.mjs            # 2020 and 2023
 *   node scripts/build-special-vote-shares.mjs --year 2023
 *   node scripts/build-special-vote-shares.mjs --check     # verify only
 *
 * The output is a share per seat, not a count: the level moves every cycle
 * (17.2% → 17.4% → 21.0% nationally) while the geography barely does, so the
 * baseline stores each seat's share *relative* to its cycle's national share and
 * the model multiplies by the current cycle's own figure.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, hasFlag } from './lib/args.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(
  ROOT,
  'packages/core/data/special-votes-by-electorate.json'
);
const CACHE_DIR = resolve(ROOT, '.cache/special-votes');
const RETRIES = 4;

const YEAR_ARG = arg('year', '');
const CHECK = hasFlag('check');
const YEARS = YEAR_ARG ? [YEAR_ARG] : ['2020', '2023'];

const archive = (year) =>
  `https://archive.electionresults.govt.nz/electionresults_${year}/xml/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (value) => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

/** Every `<tr>` in a page, as an array of trimmed, tag-stripped cell strings. */
function rows(html) {
  const body = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/&nbsp;/g, ' ');
  const out = [];
  for (const raw of body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [];
    for (const cell of raw.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []) {
      cells.push(
        cell
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&[a-z]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
    out.push(cells);
  }
  return out;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
      });
      if (res.status === 200) return await res.text();
      lastError = new Error(`${url} responded ${res.status}`);
      // Wayback rate-limits with 429/403; a cold wait is what gets through.
      await sleep(res.status === 429 ? 30_000 : 8_000);
    } catch (err) {
      lastError = err;
      await sleep(5_000);
    }
  }
  throw lastError;
}

/**
 * The Commission's special-declaration table, through the Wayback Machine.
 *
 * Cached: a re-run for a different cycle must not pay for a rate-limited host
 * twice, and the file is the evidence for the numbers in the committed JSON.
 */
async function specialTable(year) {
  const file = resolve(CACHE_DIR, `${year}-party-sdv-by-electorate.html`);
  try {
    return await readFile(file, 'utf8');
  } catch {
    // not cached yet
  }
  const url = `https://web.archive.org/web/2026id_/https://electionresults.govt.nz/electionresults_${year}/statistics/party-sdv-by-electorate.html`;
  process.stderr.write(`  fetching the ${year} special-declaration table\n`);
  const html = await fetchText(url);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, html);
  return html;
}

/** Electorate name → number, and each seat's own final total. */
async function seatTotals(year) {
  const src = archive(year);
  const electorates = await fetchText(`${src}electorates.xml`);
  const byNo = new Map();
  for (const m of electorates.matchAll(
    /<electorate\s+e_no="(\d+)"[^>]*>([\s\S]*?)<\/electorate>/g
  )) {
    const name = /<electorate_name>([^<]*)</.exec(m[2])?.[1];
    if (name) byNo.set(Number(m[1]), name);
  }

  const totals = new Map();
  await Promise.all(
    [...byNo].map(async ([no, name]) => {
      const e = String(no).padStart(2, '0');
      const res = await fetch(`${src}e${e}/e${e}.xml`);
      if (!res.ok) return;
      const xml = await res.text();
      // `total_votes_cast` is the seat's final count, specials included, which
      // is the same basis the live feed publishes and the model divides by.
      const total = Number(/<total_votes_cast>([^<]*)</.exec(xml)?.[1]) || 0;
      if (total > 0) totals.set(name, total);
    })
  );
  return totals;
}

const YEARS_OUT = {};

for (const year of YEARS) {
  const [html, totals] = await Promise.all([
    specialTable(year),
    seatTotals(year),
  ]);

  // The table's last two rows are subtotals; the electorates are everything
  // before them. Column 9 is "Total Party Special Votes Cast".
  const specials = new Map();
  for (const cells of rows(html)) {
    if (cells.length < 10) continue;
    const name = cells[0];
    if (!name || /Totals$/i.test(name)) continue;
    const cast = num(cells[9]);
    if (cast > 0) specials.set(name, cast);
  }

  const seats = {};
  let specialsTotal = 0;
  let votesTotal = 0;
  const unmatched = [];
  for (const [name, cast] of [...specials].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const votes = totals.get(name);
    if (!votes) {
      unmatched.push(name);
      continue;
    }
    seats[name] = Number((cast / votes).toFixed(4));
    specialsTotal += cast;
    votesTotal += votes;
  }

  const nationalShare = Number((specialsTotal / votesTotal).toFixed(4));
  process.stderr.write(
    `  ${year}: ${Object.keys(seats).length} seats, ${specialsTotal.toLocaleString()} specials of ${votesTotal.toLocaleString()} votes — ${(nationalShare * 100).toFixed(1)}%${unmatched.length ? `, unmatched: ${unmatched.join(', ')}` : ''}\n`
  );

  YEARS_OUT[year] = { nationalShare, seats };
}

if (CHECK) {
  const existing = JSON.parse(await readFile(OUT, 'utf8'));
  const same =
    JSON.stringify(existing.cycles) === JSON.stringify(YEARS_OUT) ||
    JSON.stringify(
      Object.fromEntries(
        Object.entries(existing.cycles).map(([year, cycle]) => [
          year,
          { nationalShare: cycle.nationalShare, seats: cycle.seats },
        ])
      )
    ) === JSON.stringify(YEARS_OUT);
  process.stderr.write(same ? '  matches the committed file\n' : '  DIFFERS\n');
  process.exit(same ? 0 : 1);
}

const payload = {
  $comment:
    'Special votes as a share of each electorate’s total votes, by cycle. Generated by scripts/build-special-vote-shares.mjs; do not hand-edit. A seat’s share moves with the cycle, so the baseline stores each seat’s share relative to its cycle’s nationalShare and the model scales it by the live cycle’s own figure.',
  provenance: {
    specialVotes:
      'Electoral Commission, “Party Special Declaration Votes by Electorate” (electionresults.govt.nz/electionresults_{YEAR}/statistics/party-sdv-by-electorate.html), column “Total Party Special Votes Cast”. The live hosts refuse /statistics/*.html, so the table is read through the Wayback Machine.',
    votes:
      'The same cycle’s archive XML: each seat’s e{NN}.xml total_votes_cast, which is the seat’s final count with specials included — the basis the live feed publishes and the model divides by.',
    note: '2023 reconciles to 602,488 of 2,884,111 named electorates against the Commission’s published 603,257 of 2,883,412; 2020 to 504,621 against 504,625. The residual is electorates the table lists but the XML does not name.',
  },
  cycles: YEARS_OUT,
};

await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
process.stderr.write(`  wrote ${OUT}\n`);
