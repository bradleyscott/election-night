import { chromium } from '/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const target = process.argv[2] ?? 'b-stadium.html';
await page.goto('file://' + process.cwd() + '/' + target, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const seats = [...document.querySelectorAll('.seat')];
  const order1 = [...document.querySelectorAll('table tbody tr')].map((tr) =>
    tr.querySelector('td:first-child span.font-bold')?.textContent.trim()
  );
  const coalition1 = document.querySelector('table tfoot td').textContent.replace(/\s+/g, ' ').trim();

  // synthetic HTML5 drag: Labour seat -> National seat
  const labour = seats.find((s) => s.getAttribute('aria-label').startsWith('Labour'));
  const national = seats.find((s) => s.getAttribute('aria-label').startsWith('National'));
  const dt = new DataTransfer();
  const fire = (el, type) =>
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));

  fire(labour, 'dragstart');
  fire(national, 'dragenter');
  const dropRings = document.querySelectorAll('.seat.is-drop').length;
  fire(national, 'drop');
  fire(labour, 'dragend');

  const order2 = [...document.querySelectorAll('table tbody tr')].map((tr) =>
    tr.querySelector('td:first-child span.font-bold')?.textContent.trim()
  );
  const coalition2 = document.querySelector('table tfoot td').textContent.replace(/\s+/g, ' ').trim();

  // positions after reorder: first Labour seat should now sit at the left end
  const firstLabour = seats
    .filter((s) => s.getAttribute('aria-label').startsWith('Labour'))
    .map((s) => s.getBoundingClientRect())
    .sort((a, b) => a.left - b.left)[0];

  // hover
  national.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  const hoverCount = document.querySelectorAll('.seat.is-hover').length;
  national.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

  // reset
  const reset = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reset');
  reset.click();
  const order3 = [...document.querySelectorAll('table tbody tr')].map((tr) =>
    tr.querySelector('td:first-child span.font-bold')?.textContent.trim()
  );

  return {
    seatCount: seats.length,
    seatLabels: new Set(seats.map((s) => s.getAttribute('aria-label').split(' ').slice(0, -2).join(' '))).size,
    order1, coalition1,
    dropRings,
    order2, coalition2,
    labourLeftAfter: Math.round(firstLabour.left),
    hoverCount,
    order3,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    labelRect: (() => {
      const r = document.getElementById('chamber-label').getBoundingClientRect();
      const c = document.getElementById('chamber').getBoundingClientRect();
      return { labelCenter: Math.round(r.left + r.width / 2), chamberCenter: Math.round(c.left + c.width / 2), labelTop: Math.round(r.top), chamberTop: Math.round(c.top) };
    })(),
    lineLen: Math.round(document.getElementById('chamber-line').getBoundingClientRect().height),
  };
});
console.log(JSON.stringify(result, null, 2));
console.log('pageerrors:', errors);
await page.close();
await browser.close();
