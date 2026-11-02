#!/usr/bin/env node
/**
 * How far the special vote moves a seat, measured — the prior behind
 * `SPECIALS_SWING_SD` in `packages/core/src/seat-probability.ts`.
 *
 * The model needs one number it cannot read from the results feed: how much a
 * seat's special votes differ from the count that finished on election night.
 * The Commission does not publish that difference as a table, but it does
 * publish both ends of it, per seat, in the per-voting-place tables:
 *
 *   statistics/candidate-votes-by-voting-place-{N}.html
 *
 * Each electorate's table lists every candidate as a column, then its voting
 * places, then four kinds of row that are not places — overseas special votes,
 * special votes before polling day, special votes on polling day, and the
 * aggregate of places with fewer than six votes — and finishes with the seat's
 * total. The three special rows are the special vote *by candidate*; subtract
 * them from the total and the rest is the ordinary count. So:
 *
 *   swing = (specials' two-candidate differential) − (count's differential)
 *
 * in share points, for the seat's top two candidates. Positive means the
 * special votes ran towards the candidate who finished ahead.
 *
 * The live hosts answer `/statistics/*.html` with a Cloudflare block while
 * still serving `/xml/*.xml`, so the pages come through the Wayback Machine
 * and are rate-limited. One parsed JSON per cycle is cached in
 * `.cache/specials-swing/`, which is the evidence for the numbers in
 * `docs/seat-probability-model.md` §4; a re-run costs nothing.
 *
 * Usage:
 *   node scripts/measure-specials-swing.mjs            # 2017, 2020, 2023
 *   node scripts/measure-specials-swing.mjs --year 2023
 *   node scripts/measure-specials-swing.mjs --json     # machine-readable
 *   node scripts/measure-specials-swing.mjs --refresh  # ignore the cache
 *
 * Every electorate's parsed total is exactly the archive's final per-candidate
 * count (checked against `archive.electionresults.govt.nz/.../e{NN}.xml`), so
 * the "ordinary count" here is a subtraction of two published figures rather
 * than a reconstruction.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, hasFlag } from './lib/args.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = resolve(ROOT, '.cache/specials-swing');

const YEAR_ARG = arg('year', '');
const YEARS = YEAR_ARG ? [YEAR_ARG] : ['2017', '2020', '2023'];
const JSON_OUT = hasFlag('json');
const REFRESH = hasFlag('refresh');
const RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  const digits = String(v ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

/** A page's `<tr>`s, each as an array of trimmed, tag-stripped cell strings. */
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
        redirect: 'follow',
      });
      const text = await res.text();
      // Wayback rate-limits with 429 and with an HTML "wait" interstitial.
      if (res.status === 200 && /<\/html>/i.test(text)) return text;
      lastError = new Error(`${url} responded ${res.status}`);
      await sleep(res.status === 429 ? 45_000 : 12_000);
    } catch (err) {
      lastError = err;
      await sleep(10_000);
    }
  }
  throw lastError;
}

/** Every captured page number for a cycle's per-voting-place tables. */
async function pageList(year) {
  const field = `${year}-pages.json`;
  try {
    if (!REFRESH)
      return JSON.parse(await readFile(resolve(CACHE_DIR, field), 'utf8'));
  } catch {
    /* not cached yet */
  }
  const url =
    'https://web.archive.org/cdx/search/cdx?url=electionresults.govt.nz/' +
    `electionresults_${year}/statistics/candidate-votes-by-voting-place` +
    '&matchType=prefix&output=json&collapse=urlkey&limit=200';
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const parsed = JSON.parse(text);
      const pages = {};
      for (const row of parsed.slice(1)) {
        const m = /voting-place-(\d+)\.html$/.exec(row[2]);
        if (m) pages[m[1]] = { timestamp: row[1], original: row[2] };
      }
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(
        resolve(CACHE_DIR, field),
        JSON.stringify(pages, null, 1)
      );
      return pages;
    } catch (err) {
      lastError = err;
      await sleep(20_000);
    }
  }
  throw lastError;
}

/**
 * One electorate page → its candidates, its total, and its special votes.
 *
 * The header row lists candidates and then two pseudo-columns ("Total Valid
 * Candidate Votes", "Informal Candidate Votes"); they must be dropped or the
 * special rows, which carry those same two figures at their end, are counted as
 * a candidate and the specials come out at exactly double.
 */
function parsePage(html) {
  let candidates = null;
  let electorate = null;
  const special = {};
  let total = null;

  for (const cells of rows(html)) {
    if (!cells.length) continue;
    if (/Candidate Vote Details?$/.test(cells[0]) && cells.length > 3) {
      candidates = cells
        .slice(1)
        .filter((c) => !/^(Total Valid|Informal)/i.test(c));
      electorate = cells[0]
        .replace(/\s+\d+$/, '')
        .replace(/\s*Candidate Vote Details?$/, '')
        .trim();
      continue;
    }
    if (!candidates) continue;

    const values = cells.slice(1, candidates.length + 1).map(num);
    if (values.length < candidates.length) continue;

    if (/Special Votes/i.test(cells[0]) && !/less than/i.test(cells[0])) {
      candidates.forEach((name, i) => {
        special[name] = (special[name] ?? 0) + values[i];
      });
    } else if (/\bTotal$/.test(cells[0])) {
      total = {};
      candidates.forEach((name, i) => {
        total[name] = values[i];
      });
    }
  }

  return { electorate, candidates, special, total };
}

/** The two-candidate differential, as a fraction of the votes in that pool. */
function differential(a, b, pool) {
  const total = Object.values(pool).reduce((n, v) => n + v, 0);
  return total > 0 ? (pool[a] - pool[b]) / total : null;
}

function measure(seats) {
  const out = [];
  for (const [electorate, s] of Object.entries(seats)) {
    if (!s.special || !s.total) continue;
    const top = Object.keys(s.total)
      .sort((a, b) => s.total[b] - s.total[a])
      .slice(0, 2);
    if (top.length < 2) continue;
    const [a, b] = top;

    const ordinary = {};
    for (const name of Object.keys(s.total)) {
      ordinary[name] = s.total[name] - (s.special[name] ?? 0);
    }
    const dSpecial = differential(a, b, s.special);
    const dOrdinary = differential(a, b, ordinary);
    if (dSpecial === null || dOrdinary === null) continue;

    const specialTotal = Object.values(s.special).reduce((n, v) => n + v, 0);
    if (specialTotal <= 0) continue;

    out.push({
      electorate,
      winner: a,
      runnerUp: b,
      specialVotes: specialTotal,
      finalMargin: s.total[a] - s.total[b],
      countMargin: ordinary[a] - ordinary[b],
      swing: Number(((dSpecial - dOrdinary) * 100).toFixed(2)),
    });
  }
  return out.sort((x, y) => x.electorate.localeCompare(y.electorate));
}

function stats(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  );
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) =>
    sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return {
    n,
    mean,
    sd,
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
    over10: values.filter((v) => Math.abs(v) > 10).length,
  };
}

const results = {};
for (const year of YEARS) {
  const field = `${year}-seats.json`;
  let measured;
  try {
    if (REFRESH) throw new Error('refresh');
    measured = JSON.parse(await readFile(resolve(CACHE_DIR, field), 'utf8'));
  } catch {
    const pages = await pageList(year);
    const sorted = Object.keys(pages).sort((a, b) => Number(a) - Number(b));
    const pageDir = resolve(CACHE_DIR, year);
    await mkdir(pageDir, { recursive: true });
    const seats = {};

    for (const [i, page] of sorted.entries()) {
      const { timestamp, original } = pages[page];
      const url = `https://web.archive.org/web/${timestamp}id_/${original}`;
      // Raw pages are cached so a long, rate-limited run is resumable and the
      // parse can be re-checked without going back to the Wayback Machine.
      const file = resolve(pageDir, `p${String(page).padStart(2, '0')}.html`);
      let html;
      try {
        html = await readFile(file, 'utf8');
      } catch {
        html = await fetchText(url);
        await writeFile(file, html);
        await sleep(1_000);
      }

      const parsed = parsePage(html);
      if (parsed.electorate) {
        seats[parsed.electorate] = {
          source: url,
          candidates: parsed.candidates,
          special: parsed.special,
          total: parsed.total,
        };
      }
      process.stderr.write(
        `  ${year}: ${i + 1}/${sorted.length} — ${parsed.electorate ?? 'unparsed'}\n`
      );
      // Persist as we go: an interrupted run resumes from the page cache.
      await writeFile(
        resolve(CACHE_DIR, field),
        JSON.stringify(seats, null, 1)
      );
    }
    measured = seats;
  }
  results[year] = measure(measured);
}

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 1));
} else {
  const pooled = [];
  console.log(
    'cycle    n     mean      sd  median     p10     p90  |swing|>10'
  );
  for (const [year, seats] of Object.entries(results)) {
    const s = stats(seats.map((r) => r.swing));
    pooled.push(...seats.map((r) => r.swing - s.mean));
    const f = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`.padStart(7);
    console.log(
      `${year}  ${String(s.n).padStart(3)}  ${f(s.mean)}  ${f(s.sd)}  ${f(
        s.median
      )}  ${f(s.p10)}  ${f(s.p90)}  ${String(s.over10).padStart(9)}`
    );
  }
  const within = stats(pooled);
  console.log(
    `\nwithin-cycle sd (each cycle's own mean removed): ${within.sd.toFixed(
      2
    )} points across ${within.n} seats`
  );
  console.log(
    'That is the per-seat spread `SPECIALS_SWING_SD` stands in for; the cycle\n' +
      'mean is a separate, cycle-level fact the model deliberately does not encode.'
  );
}
