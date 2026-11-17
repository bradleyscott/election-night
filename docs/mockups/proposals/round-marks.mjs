import { chromium } from '/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const FILE = 'd-stadium-dots.html';
const browser = await chromium.launch();

// desktop, clipped to the panel
const desk = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await desk.goto('file://' + process.cwd() + '/' + FILE, { waitUntil: 'networkidle' });
await desk.waitForTimeout(1400);
const dProbe = await desk.evaluate(() => {
  const r = document.getElementById('chamber');
  return { w: r.clientWidth, h: r.clientHeight, seat: parseFloat(getComputedStyle(document.querySelector('.seat')).width) };
});
await desk.screenshot({ path: 'round-desktop.png', clip: { x: 40, y: 355, width: 900, height: 566 } });
await desk.screenshot({ path: 'round-desktop-full.png', fullPage: true });
await desk.close();

// phone at natural width
const phone = await browser.newPage({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2 });
await phone.goto('file://' + process.cwd() + '/' + FILE, { waitUntil: 'networkidle' });
await phone.waitForTimeout(1400);
const pProbe = await phone.evaluate(() => {
  const r = document.getElementById('chamber');
  return { w: r.clientWidth, h: r.clientHeight, seat: parseFloat(getComputedStyle(document.querySelector('.seat')).width),
           docW: document.documentElement.scrollWidth };
});
await phone.screenshot({ path: 'round-phone.png', fullPage: false });
await phone.screenshot({ path: 'round-phone-full.png', fullPage: true });
await phone.close();
console.log('desktop', JSON.stringify(dProbe), 'phone', JSON.stringify(pProbe));

const b64 = (f) => readFileSync(f).toString('base64');
const sheet = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600&family=Inter:wght@400;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<style>
 body{margin:0;padding:22px 24px 10px;background:hsl(60 9% 94%);color:hsl(40 6% 13%);font-family:'Inter',system-ui,sans-serif;width:1000px}
 h1{font-family:'Playfair Display',serif;font-size:24px;margin:0 0 4px}
 .intro{font-family:'Crimson Pro',Georgia,serif;font-size:16px;margin:0 0 16px;color:hsl(45 6% 37%)}
 h3{font-family:'Playfair Display',serif;font-size:19px;margin:0 0 2px}
 p{font-family:'Crimson Pro',Georgia,serif;font-size:15px;margin:0 0 10px;color:hsl(45 6% 37%)}
 section{margin:0 0 18px}
 .tag{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:hsl(14 55% 38%);margin-bottom:4px}
 img{display:block;border:1px solid hsl(50 5% 80%);background:hsl(60 12% 97%)}
 .desk{width:900px}
 .row{display:flex;gap:24px;align-items:flex-start}
 .phone{width:390px}
 .foot{font-family:'Crimson Pro',Georgia,serif;font-size:13px;color:hsl(45 6% 37%)}
</style></head><body>
<h1>Round seat marks on the chamber shape</h1>
<p class="intro">Same 123 seats, same fills, same drag and majority marker; only the mark and the shape changed. Desktop is the panel at 1280px, phone is a real 390px viewport at 2x (not a scaled-down desktop).</p>
<section><div class="tag">Desktop · 1280px</div><h3>704 &times; 540 chamber, 19.8px seats</h3>
<p>Straight benches either side of the floor, round end, Speaker in the gap. The panel holds it at 878px wide.</p>
<img class="desk" src="data:image/png;base64,${b64('round-desktop.png')}"></section>
<section><div class="tag">Phone · 390px</div>
<div class="row"><img class="phone" src="data:image/png;base64,${b64('round-phone.png')}">
<div style="width:536px"><h3>262px tall, 9px seats</h3>
<p>Fits the 324px panel with no sideways scroll. The shipped grid is 480px minimum and scrolls here, so the chamber is the first view of Parliament that fits a phone whole.</p>
<p>The majority label still sits over the apex, the party blocks still read left to right from the Government benches, and tapping a seat still opens the sheet.</p>
<h3 style="margin-top:14px">What does not change</h3>
<p>Drag: drag a seat onto another party's to reorder — the table re-sorts and the coalition line recomputes. Keyboard: space to pick up, arrows to move a bench (&#8593;&#8595;) or along it (&#8592;&#8594;), Enter to drop, Esc to cancel.</p></div></div></section>
<p class="foot">Layout comp drawn on the running /seats page (2026 mock feed, 87.4% counted). Not a build.</p>
</body></html>`;

const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.setContent(sheet, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'round-marks-desktop-mobile.png', fullPage: true });
await page.close();
await browser.close();
