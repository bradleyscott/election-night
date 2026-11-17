import { chromium } from '/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const CLIP = { x: 40, y: 355, width: 900, height: 566 };
const CLIP_SHORT = { x: 40, y: 355, width: 900, height: 434 };

const shots = [
  { file: 'a-semicircle.html', out: 'a-semicircle-desktop.png', width: 1280, height: 900 },
  { file: 'b-stadium.html', out: 'b-stadium-desktop.png', width: 1280, height: 900 },
  { file: 'b-stadium.html', out: 'b-stadium-phone.png', width: 390, height: 820, scale: 2 },
  { file: 'a-semicircle.html', out: 'a-semicircle-phone.png', width: 390, height: 820, scale: 2 },
  { file: 'b-stadium.html', out: 'clip-squares.png', width: 1280, height: 1000, clip: CLIP },
  { file: 'd-stadium-dots.html', out: 'clip-dots.png', width: 1280, height: 1000, clip: CLIP },
  { file: 'a-semicircle.html', out: 'clip-hemisphere.png', width: 1280, height: 1000, clip: CLIP_SHORT },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.scale ?? 1,
  });
  await page.goto('file://' + process.cwd() + '/' + s.file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const probe = await page.evaluate(() => {
    const root = document.getElementById('chamber');
    const first = document.querySelector('.seat');
    return {
      chamberW: root?.clientWidth,
      chamberH: root?.clientHeight,
      seatSize: first ? Math.round(first.getBoundingClientRect().width * 10) / 10 : null,
      seats: document.querySelectorAll('.seat').length,
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
    };
  });
  console.log(s.file, s.width, JSON.stringify(probe));
  await page.screenshot({ path: s.out, fullPage: s.clip ? false : true, ...(s.clip ? { clip: s.clip } : {}) });
  await page.close();
}

// comparison sheets
const b64 = (f) => readFileSync(f).toString('base64');
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });

function sheet(title, intro, rows) {
  const sections = rows
    .map(
      (r) => `<section><div class="tag">${r.tag}</div><h3>${r.title}</h3><p>${r.body}</p>
<img src="data:image/png;base64,${b64(r.img)}"></section>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600&family=Inter:wght@400;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<style>
 body{margin:0;padding:22px 24px 8px;background:hsl(60 9% 94%);color:hsl(40 6% 13%);font-family:'Inter',system-ui,sans-serif;width:1000px}
 h2{font-family:'Playfair Display',serif;font-size:24px;margin:0 0 4px}
 .intro{font-family:'Crimson Pro',Georgia,serif;font-size:16px;margin:0 0 18px;color:hsl(45 6% 37%)}
 h3{font-family:'Playfair Display',serif;font-size:19px;margin:0 0 2px}
 p{font-family:'Crimson Pro',Georgia,serif;font-size:15px;margin:0 0 10px;color:hsl(45 6% 37%)}
 section{margin-bottom:20px}
 img{display:block;width:900px;border:1px solid hsl(50 5% 80%);background:hsl(60 12% 97%)}
 .tag{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:hsl(14 55% 38%);margin-bottom:4px}
</style></head><body><h2>${title}</h2><p class="intro">${intro}</p>${sections}</body></html>`;
}

async function shoot(name, html) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: name, fullPage: true });
  console.log('wrote', name);
}

await shoot(
  'shape-sheet.png',
  sheet(
    'Two shapes for the 123 seats',
    'Same seats, same fills, same handlers. The hemisphere is what the grid becomes if the arc is a circle; the chamber has straight benches either side of the floor and a round end, which is the debating chamber.',
    [
      {
        tag: 'A',
        title: 'Hemisphere',
        body: '180&deg;, one radius from the floor. 744 &times; 410 in the panel, seat 17.0px.',
        img: 'clip-hemisphere.png',
      },
      {
        tag: 'B',
        title: 'Chamber: straight benches, round end',
        body: 'Arms run parallel past the Table (the Speaker sits in the gap), the end is a semicircle. 704 &times; 540, seat 19.8px.',
        img: 'clip-squares.png',
      },
    ]
  )
);

await shoot(
  'seat-mark-sheet.png',
  sheet(
    'Seat mark',
    'Both drawn on the chamber shape, at the same seat size and the same fills.',
    [
      {
        tag: 'A',
        title: 'Square seat mark (what the grid uses today)',
        body: 'Rotated to the path, so each seat faces the floor of the chamber. Reads as a seating plan.',
        img: 'clip-squares.png',
      },
      {
        tag: 'B',
        title: 'Round seat mark',
        body: 'The conventional parliament-chart dot. Same arc, same block boundaries, same fills; only the mark changes.',
        img: 'clip-dots.png',
      },
    ]
  )
);

await page.close();
await browser.close();
