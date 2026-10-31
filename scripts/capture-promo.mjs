#!/usr/bin/env node
/**
 * Capture promotional screenshots from the running dashboard.
 *
 * These are captures of the real application — the built Vite bundle, the
 * shipped stylesheet, real mock results — driven over the Chrome DevTools
 * Protocol. Nothing is drawn by hand, so what is in the promo set is what
 * ships. `docs/mockups/README.md` describes the same technique for the design
 * captures; this script is the reproducible version of it, with the two things
 * promotional material needs:
 *
 *   1. `/api/config` is answered in the page so the masthead reads
 *      "Polls closed · counting" instead of counting down to election day.
 *      The visitor's clock is left alone, so every "2 min ago" in the UI stays
 *      truthful.
 *   2. Each shot waits for a readiness expression naming the finished content
 *      (seat marks, chart lines, table rows) and for the absence of the
 *      waiting states, so no capture can contain a spinner, a tally animation
 *      or "Awaiting results".
 *
 * Usage:
 *
 *   # Stack: mock feed (3557), collector (3559), dashboard server (3556)
 *   npm run build
 *   npx tsx packages/collector/src/serve-mock.ts --year 2026 --port 3557 --stage late
 *   ELECTION_YEAR=2026 XML_FEED_BASE_URL=http://localhost:3557/ \\
 *     POLL_INTERVAL_MS=5000 WS_URL=ws://127.0.0.1:3556 HEALTH_PORT=3559 \\
 *     DB_PATH=.data/promo/election_results.db \\
 *     RESULTS_CACHE_PATH=.data/promo/electorate_results.json \\
 *     npx tsx packages/collector/src/index.ts
 *   ELECTION_YEAR=2026 WS_PORT=3556 HISTORY_UPSTREAM=http://127.0.0.1:3559 \\
 *     DIST_DIR=packages/dashboard/dist \\
 *     CACHE_PATH=.data/promo/electorate_results.json \\
 *     FEED_CACHE_PATH=.data/promo/feed_events.json \\
 *     npx tsx packages/dashboard/server/index.ts
 *
 *   node scripts/capture-promo.mjs
 *   node scripts/capture-promo.mjs --only seats,flipped --viewports desktop
 *
 * Options:
 *   --base <url>        Dashboard origin (default http://127.0.0.1:3556)
 *   --out <dir>         Output directory (default docs/promo)
 *   --seat <name>       Seat opened on the Electorates page (default Mt Albert)
 *   --only <names>      Comma-separated shot names to capture
 *   --viewports <list>  desktop,mobile (default both)
 *   --full              Also write a full-page image where the page is taller
 *                       than the viewport (`<shot>-<viewport>-full.png`)
 *   --keep-open         Leave Chrome running when the run finishes
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyViewport,
  CDP,
  installCaptureCss,
  launchChrome,
  openPage,
  sleep,
  stubRuntimeConfig,
  THEME_AND_MOTION_CSS,
} from './lib/cdp.mjs';

const argv = process.argv.slice(2);
function flag(name) {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  return argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : true;
}

const BASE = String(flag('--base') ?? 'http://127.0.0.1:3556').replace(/\/$/, '');
const OUT = path.resolve(String(flag('--out') ?? 'docs/promo'));
const SEAT = String(flag('--seat') ?? 'Mt Albert');
const ONLY = flag('--only') ? String(flag('--only')).split(',').map((s) => s.trim()) : null;
const VIEWPORTS = String(flag('--viewports') ?? 'desktop,mobile')
  .split(',')
  .map((s) => s.trim());
const FULL = Boolean(flag('--full'));
const KEEP_OPEN = Boolean(flag('--keep-open'));
const ELECTION_YEAR = String(flag('--year') ?? '2026');

const VIEWPORT_PRESETS = {
  desktop: { width: 1600, height: 1000, dpr: 2, mobile: false },
  mobile: { width: 390, height: 844, dpr: 2, mobile: true },
};

/** Copy that must not be on a promotional capture. */
const NO_WAITING = `
  !/Awaiting|Reconnecting|Connecting[.][.][.]|Loading|No results yet|Take shape/i.test(document.body.innerText)
`;

/** Map tiles have painted at least a few blocks of geography. */
const MAP_READY = `
  !!document.querySelector('.leaflet-container') &&
  document.querySelectorAll('img.leaflet-tile-loaded').length >= 4
`;

const SHOTS = [
  {
    name: 'seats',
    path: '/',
    title: 'Seats — parliament, party totals and every seat',
    viewports: ['desktop', 'mobile'],
    ready: `
      document.querySelectorAll('[aria-label$="seat"]').length > 100 &&
      /parliament/i.test(document.body.innerText) &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'electorates-map',
    path: '/electorates',
    title: 'Electorates — the national map',
    viewports: ['desktop', 'mobile'],
    ready: `
      ${MAP_READY} &&
      document.querySelectorAll('path.leaflet-interactive').length > 55 &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'electorates-seat',
    path: '/electorates/' + encodeURIComponent(SEAT),
    title: `${SEAT} — map, seat verdict, candidate votes and past winners`,
    viewports: ['desktop', 'mobile'],
    ready: `
      ${MAP_READY} &&
      /past winners/i.test(document.body.innerText) &&
      // On a phone the ledger card is deliberately hidden; the legend above
      // the map's footer carries the same two states.
      (/voting places/i.test(document.body.innerText) ||
        /not yet counted/i.test(document.body.innerText)) &&
      !/Awaiting|Reconnecting|Connecting[.][.][.]|Loading/i.test(document.body.innerText)
    `,
    fullPage: true,
  },
  {
    name: 'parties',
    path: '/parties',
    title: 'Party lists — rankings, list cut lines, projected parliament',
    viewports: ['desktop'],
    ready: `
      /party list rankings/i.test(document.body.innerText) &&
      /\\bcut\\b/i.test(document.body.innerText) &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'close-calls',
    path: '/close-calls',
    title: 'Close Calls — the seats most likely to change hands',
    viewports: ['desktop'],
    ready: `
      document.querySelectorAll('a[href^="/electorates/"]').length > 3 &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'flipped',
    path: '/flipped',
    title: 'Flipped — seats that have changed hands since the prior cycle',
    viewports: ['desktop', 'mobile'],
    ready: `
      /flipped/i.test(document.body.innerText) &&
      document.querySelectorAll('a[href^="/electorates/"]').length > 3 &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'feed',
    path: '/feed',
    title: 'Feed — the night as it happens',
    viewports: ['desktop', 'mobile'],
    ready: `
      /feed/i.test(document.body.innerText) &&
      document.querySelectorAll('a[href^="/electorates/"]').length > 4 &&
      ${NO_WAITING}
    `,
    // No full-page variant: the feed is unbounded, and a full capture is
    // tens of thousands of pixels of stacked events.
  },
  {
    name: 'trends',
    path: '/trends',
    title: 'Trends — party vote, share, seats and count progress over time',
    viewports: ['desktop'],
    ready: `
      document.querySelectorAll('.recharts-surface').length >= 1 &&
      document.querySelectorAll('.recharts-line').length > 0 &&
      /trends/i.test(document.body.innerText) &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'trends-counted',
    path: '/trends',
    title: 'Trends — the count tape: how much of the vote is in',
    viewports: ['desktop'],
    click: 'Counted',
    ready: `
      /count progress over time/i.test(document.body.innerText) &&
      !!document.querySelector('svg[aria-label^="Counted"]') &&
      ${NO_WAITING}
    `,
  },
  {
    name: 'trends-percent',
    path: '/trends',
    title: 'Trends — party vote share over time',
    viewports: ['desktop'],
    click: '% of Vote',
    ready: `
      /party vote share over time/i.test(document.body.innerText) &&
      document.querySelectorAll('.recharts-line').length > 0 &&
      ${NO_WAITING}
    `,
  },
];

const log = (...args) => console.log(...args);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await launchChrome({ width: 1600, height: 1000 });
  const cdp = await CDP.connect(chrome.browserWs);

  const shots = SHOTS.filter((shot) => !ONLY || ONLY.includes(shot.name));
  const manifest = [];

  try {
    for (const shot of shots) {
      const viewports = shot.viewports.filter((v) => VIEWPORTS.includes(v));
      for (const viewportName of viewports) {
        const preset = VIEWPORT_PRESETS[viewportName];
        const page = await openPage(cdp);
        page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
          log(
            `  ! ${shot.name}/${viewportName}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`
          );
        });

        await page.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'light' }],
        });
        await page.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `try { localStorage.setItem('election-night:theme', 'light'); } catch (e) {}`,
        });
        await applyViewport(page, preset);
        await page.send('Page.enable');
        await stubRuntimeConfig(page, {
          electionYear: ELECTION_YEAR,
          minutesSinceClose: 25,
        });

        const target = `${BASE}${shot.path}`;
        log(`→ ${shot.name} (${viewportName}) ${target}`);
        await page.navigate(target);
        await page.waitFor(`document.fonts.status === 'loaded'`, {
          label: 'fonts to load',
        });
        if (shot.click) {
          const clicked = await page.evaluate(
            `(() => {
              const label = ${JSON.stringify(shot.click)};
              const el = [...document.querySelectorAll('button')].find(
                (b) => b.textContent.trim() === label
              );
              if (!el) return false;
              el.click();
              return true;
            })()`
          );
          if (!clicked) throw new Error(`No button labelled "${shot.click}"`);
        }
        await page.waitFor(shot.ready, { timeout: 45_000, label: shot.ready });
        await installCaptureCss(page, THEME_AND_MOTION_CSS);
        await sleep(1200);
        await page.evaluate('window.scrollTo(0, 0)');
        await sleep(250);

        const png = await page.screenshot();
        const file = path.join(OUT, `${shot.name}-${viewportName}.png`);
        writeFileSync(file, png);
        log(`  saved ${path.relative(process.cwd(), file)} (${Math.round(png.length / 1024)} kB)`);
        manifest.push({
          name: shot.name,
          viewport: viewportName,
          file: path.relative(OUT, file),
          title: shot.title,
        });

        if (FULL && shot.fullPage) {
          const height = await page.evaluate(
            'document.documentElement.scrollHeight'
          );
          if (height > preset.height + 40) {
            // Grow the viewport rather than using `captureBeyondViewport`: the
            // latter resizes the page during capture, which makes Recharts'
            // ResponsiveContainer re-measure and drops the plotted lines from
            // the image. Rendering once at the final height avoids that.
            await applyViewport(page, { ...preset, height });
            await sleep(1500);
            const full = await page.screenshot();
            const fullFile = path.join(
              OUT,
              `${shot.name}-${viewportName}-full.png`
            );
            writeFileSync(fullFile, full);
            log(
              `  saved ${path.relative(process.cwd(), fullFile)} (${Math.round(full.length / 1024)} kB, ${height}px tall)`
            );
            manifest.push({
              name: shot.name,
              viewport: viewportName,
              file: path.relative(OUT, fullFile),
              title: `${shot.title} (full page)`,
            });
          }
        }

        await page.close();
      }
    }

    writeFileSync(
      path.join(OUT, 'manifest.json'),
      JSON.stringify({ base: BASE, seat: SEAT, shots: manifest }, null, 2) + '\n'
    );
    log(`\n${manifest.length} images in ${path.relative(process.cwd(), OUT)}`);
  } finally {
    cdp.close();
    if (chrome.proc && !KEEP_OPEN) chrome.proc.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
