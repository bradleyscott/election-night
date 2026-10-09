#!/usr/bin/env node
/**
 * Regenerate the dashboard's app icons.
 *
 * The logo is a wide mark — the mascot plus two ballot flags, 81.4 × 54.6 in its
 * own coordinates — and every platform that shows an app icon crops it to a
 * square: the home screen, the Android splash, the iOS splash, the browser tab.
 * Rasterising the wide mark straight to a "512x512" filename therefore ships a
 * 512 × 390 PNG that the OS stretches vertically, which is exactly how the
 * splash screen ended up with a squashed mascot.
 *
 * So the mark is laid into a square canvas here, once, and every icon the app
 * ships is that one canvas rendered at a declared, real size. The maskable
 * variant is the same canvas scaled down until the artwork's corners sit inside
 * Android's 80% safe circle, because a maskable icon is cropped, not padded.
 *
 * Usage:  node scripts/generate-icons.mjs
 * Needs:  Inkscape (preferred, accurate) or ImageMagick on PATH.
 *
 * `packages/dashboard/src/lib/app-icons.test.ts` asserts the shipped files
 * against the manifest, so a stale icon is a failing test rather than a
 * squashed splash screen.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'packages/dashboard/public');

/** Every icon is this square canvas, scaled to the size it is declared at. */
const CANVAS = 512;
/** Newsprint stock — the light edition's page, and the manifest's splash. */
const PAPER = '#f7f4eb';
/**
 * The artwork's own bounding box, measured from the rendered mark (it is a
 * hair wider than the paths alone because it includes their antialiased edge).
 */
const ARTWORK = { x: -8.7, y: 2.2, width: 81.4, height: 54.6 };
/** Fraction of the canvas the "any" icons let the artwork span. */
const ANY_FRACTION = 0.96;
/**
 * Android crops a maskable icon to a circle covering the middle 80% of the
 * canvas, so the artwork has to fit *inside* that circle — a maskable icon is
 * cropped, never padded. 0.98 of the radius leaves a hair of slack against
 * rounding.
 */
const MASKABLE_SAFE_RADIUS = (0.8 / 2) * 0.98;

const ARTWORK_SVG = `  <defs>
    <linearGradient id="og" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FF8C00"/>
      <stop offset="100%" stop-color="#E06000"/>
    </linearGradient>
  </defs>
  <path d="M32 6C18 6 12 14 12 22C12 30 10 38 8 46C6 52 12 56 20 56C26 56 30 54 32 54C34 54 38 56 44 56C52 56 58 52 56 46C54 38 52 30 52 22C52 14 46 6 32 6Z" fill="url(#og)"/>
  <path d="M12 20C8 16 4 12 4 8C4 4 10 2 12 6C14 10 16 16 14 20Z" fill="url(#og)"/>
  <rect x="26" y="18" width="4.5" height="8" rx="1.5" fill="white"/>
  <rect x="33.5" y="18" width="4.5" height="8" rx="1.5" fill="white"/>
  <path d="M23 30 Q32 38 41 30" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M 14 36 Q 8 34 6 40" fill="none" stroke="url(#og)" stroke-width="5" stroke-linecap="round"/>
  <path d="M 50 36 Q 56 34 58 40" fill="none" stroke="url(#og)" stroke-width="5" stroke-linecap="round"/>
  <circle cx="6" cy="40" r="3" fill="#E06000"/>
  <circle cx="58" cy="40" r="3" fill="#E06000"/>
  <line x1="6" y1="40" x2="3" y2="8" stroke="#8B4513" stroke-width="2" stroke-linecap="round"/>
  <line x1="58" y1="40" x2="61" y2="8" stroke="#8B4513" stroke-width="2" stroke-linecap="round"/>
  <path d="M 3 10 L -8 20 L 5 34 Z" fill="#2563EB"/>
  <path d="M 61 10 L 72 20 L 59 34 Z" fill="#DC2626"/>
  <circle cx="3" cy="8" r="1.5" fill="#8B4513"/>
  <circle cx="61" cy="8" r="1.5" fill="#8B4513"/>`;

/**
 * The scale that makes the artwork span `fraction` of the canvas, and the
 * offset that centres the artwork's own bounding box on the canvas centre —
 * the mark is not symmetric about the origin, so centring on the viewBox
 * instead would leave it visibly off-centre.
 */
function layout(fraction) {
  const scale = (fraction * CANVAS) / ARTWORK.width;
  const centreX = ARTWORK.x + ARTWORK.width / 2;
  const centreY = ARTWORK.y + ARTWORK.height / 2;
  return {
    scale,
    x: CANVAS / 2 - centreX * scale,
    y: CANVAS / 2 - centreY * scale,
  };
}

/**
 * The maskable layout: the artwork box's half-diagonal — its worst-case corner —
 * has to reach no further than the safe circle, expressed as the fraction of the
 * canvas the artwork may span.
 */
function maskableFraction() {
  const halfDiagonal = Math.hypot(ARTWORK.width, ARTWORK.height) / 2;
  const safeRadius = MASKABLE_SAFE_RADIUS * CANVAS;
  const scale = safeRadius / halfDiagonal;
  return (scale * ARTWORK.width) / CANVAS;
}

function iconSvg(fraction) {
  const { scale, x, y } = layout(fraction);
  const round = (n) => Number(n.toFixed(4));
  const artwork = ARTWORK_SVG.split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <rect width="${CANVAS}" height="${CANVAS}" fill="${PAPER}"/>
  <g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})">
${artwork}
  </g>
</svg>
`;
}

function hasCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * ImageMagick is required — it builds the .ico and measures the artwork back out
 * of the rendered PNGs to check nothing is clipped. Inkscape, when present, does
 * the rasterising: it renders SVG geometry more faithfully than ImageMagick's
 * built-in renderer.
 */
function rasteriser() {
  if (!hasCommand('magick')) {
    throw new Error(
      'Needs ImageMagick for the .ico and the geometry check: `brew install imagemagick`.'
    );
  }
  return hasCommand('inkscape') ? 'inkscape' : 'magick';
}

function render(engine, svgPath, size, outPath) {
  if (engine === 'inkscape') {
    // The canvas rect already fills the square; the background flags make the
    // PNG opaque even if a maskable variant is ever drawn without one.
    execFileSync(
      'inkscape',
      [
        svgPath,
        '--export-type=png',
        `--export-filename=${outPath}`,
        `--export-width=${size}`,
        `--export-height=${size}`,
        `--export-background=${PAPER}`,
        '--export-background-opacity=1',
      ],
      { stdio: 'pipe' }
    );
    return;
  }
  execFileSync(
    'magick',
    ['-background', PAPER, svgPath, '-resize', `${size}x${size}!`, outPath],
    { stdio: 'pipe' }
  );
}

function pngSize(file) {
  const buffer = readFileSync(file);
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** The artwork's own box inside a rendered icon, in canvas pixels. */
function artworkBox(file) {
  const out = execFileSync(
    'magick',
    [file, '-fuzz', '1%', '-trim', '-format', '%w %h %X %Y', 'info:'],
    { encoding: 'utf8' }
  ).trim();
  const [width, height, left, top] = out.split(/\s+/);
  return {
    width: Number(width),
    height: Number(height),
    // ImageMagick reports the page offset as "+14+100".
    x: Number(left),
    y: Number(top),
  };
}

const engine = rasteriser();
const scratch = mkdtempSync(join(tmpdir(), 'election-night-icons-'));
const anySvg = join(scratch, 'icon.svg');
writeFileSync(anySvg, iconSvg(ANY_FRACTION));
const maskableSvg = join(scratch, 'icon-maskable.svg');
writeFileSync(maskableSvg, iconSvg(maskableFraction()));

const written = [];
for (const { file, size, svg } of [
  { file: 'icon-192.png', size: 192, svg: anySvg },
  { file: 'icon-512.png', size: 512, svg: anySvg },
  { file: 'apple-touch-icon.png', size: 180, svg: anySvg },
  { file: 'icon-maskable-512.png', size: 512, svg: maskableSvg },
]) {
  const out = join(PUBLIC_DIR, file);
  render(engine, svg, size, out);
  const actual = pngSize(out);
  if (actual.width !== size || actual.height !== size) {
    throw new Error(
      `${file} came out ${actual.width}x${actual.height}, expected ${size}x${size}`
    );
  }
  written.push(`${file} ${actual.width}x${actual.height}`);
}

const anyBox = artworkBox(join(PUBLIC_DIR, 'icon-512.png'));
if (
  anyBox.x < 2 ||
  anyBox.y < 2 ||
  anyBox.x + anyBox.width > CANVAS - 2 ||
  anyBox.y + anyBox.height > CANVAS - 2
) {
  throw new Error(
    `The "any" artwork is clipped by the canvas (${anyBox.width}x${anyBox.height} at ${anyBox.x},${anyBox.y}) — lower ANY_FRACTION`
  );
}

const maskableBox = artworkBox(join(PUBLIC_DIR, 'icon-maskable-512.png'));
const maskableReach = Math.hypot(maskableBox.width, maskableBox.height) / 2;
const safeRadius = 0.4 * CANVAS;
if (maskableReach > safeRadius) {
  throw new Error(
    `The maskable artwork reaches ${maskableReach.toFixed(1)}px from the centre; Android clips beyond ${safeRadius}px`
  );
}

// The tab icon is an SVG so it stays sharp at any density — same square canvas.
writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), iconSvg(ANY_FRACTION));
written.push('favicon.svg (square viewBox, any size)');

// A .ico cannot be resized by the OS, so ship the sizes browsers ask for.
const frames = [48, 32, 16].map((size) => {
  const out = join(scratch, `favicon-${size}.png`);
  render(engine, anySvg, size, out);
  return out;
});
execFileSync('magick', [...frames, join(PUBLIC_DIR, 'favicon.ico')], {
  stdio: 'pipe',
});
written.push('favicon.ico 48x48, 32x32, 16x16');

rmSync(scratch, { recursive: true, force: true });
console.log(`Wrote to packages/dashboard/public (${engine}):`);
for (const line of written) console.log(`  ${line}`);
