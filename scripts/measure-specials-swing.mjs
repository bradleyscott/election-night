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
import {
  CACHE_VERSION,
  decodeParsedCache,
  encodeParsedCache,
  measure,
  parsePage,
  stats,
} from './lib/specials-swing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = resolve(ROOT, '.cache/specials-swing');

const YEAR_ARG = arg('year', '');
const YEARS = YEAR_ARG ? [YEAR_ARG] : ['2017', '2020', '2023'];
const JSON_OUT = hasFlag('json');
const REFRESH = hasFlag('refresh');
const RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

const results = {};
for (const year of YEARS) {
  const field = `${year}-seats.json`;
  let measured;
  try {
    if (REFRESH) throw new Error('refresh');
    const raw = await readFile(resolve(CACHE_DIR, field), 'utf8');
    const cached = decodeParsedCache(raw, year);
    if (!cached) {
      process.stderr.write(
        `  ${year}: parsed cache is not version ${CACHE_VERSION}; regenerating\n`
      );
      throw new Error('stale cache');
    }
    measured = cached;
  } catch {
    const pages = await pageList(year);
    const sorted = Object.keys(pages).sort((a, b) => Number(a) - Number(b));
    const pageDir = resolve(CACHE_DIR, year);
    await mkdir(pageDir, { recursive: true });
    const seats = {};
    const sources = [];

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

      sources.push({ page, url });
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
        encodeParsedCache({ year, seats, sources })
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
