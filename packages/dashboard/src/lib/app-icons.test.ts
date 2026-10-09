import { describe, expect, test } from 'vitest';
import icon192 from '../../public/icon-192.png?inline';
import icon512 from '../../public/icon-512.png?inline';
import maskable512 from '../../public/icon-maskable-512.png?inline';
import appleTouchIcon from '../../public/apple-touch-icon.png?inline';
import faviconIco from '../../public/favicon.ico?inline';
import faviconSvg from '../../public/favicon.svg?raw';
import manifestRaw from '../../public/site.webmanifest?raw';
import indexHtml from '../../index.html?raw';

/**
 * The install icons are declared square in the manifest while the files on disk
 * were, for a while, 512×390 and 192×146 — the logo's own wide aspect ratio
 * rasterised to a width. Every platform then stretched them vertically, so the
 * home screen and the splash screen showed a squashed mascot. Nothing in the app
 * referenced a raster icon, so nothing caught it.
 *
 * These assertions read the bytes Vite actually ships — the same reason
 * `electorates.test.ts` reads the shipped boundary manifest — and pin the one
 * property the OS relies on: the icon is the size it claims to be. The files are
 * produced by `scripts/generate-icons.mjs`.
 *
 * They arrive as inlined assets rather than through `fs`, so this stays a
 * browser project: `packages/dashboard/tsconfig.json` deliberately has no Node
 * types, and adding them would retype `setTimeout` as `Timeout` across the app.
 */
const manifest = JSON.parse(manifestRaw) as {
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};

/** The icons the manifest points at, as Vite serves them. */
const SHIPPED: Record<string, string> = {
  '/icon-192.png': icon192,
  '/icon-512.png': icon512,
  '/icon-maskable-512.png': maskable512,
};

function decodeDataUri(uri: string) {
  const match = /^data:([^,]*),(.*)$/s.exec(uri);
  if (!match || !match[1].includes('base64')) {
    throw new Error('expected an inlined base64 asset');
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** PNG dimensions straight out of the IHDR chunk. */
function pngSize(uri: string) {
  const bytes = decodeDataUri(uri);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** ICO frame dimensions from the directory, where 0 means 256. */
function icoSizes(uri: string) {
  const bytes = decodeDataUri(uri);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(0, true)).toBe(0); // reserved
  expect(view.getUint16(2, true)).toBe(1); // type: icon
  return Array.from({ length: view.getUint16(4, true) }, (_, index) => {
    const entry = 6 + index * 16;
    const side = (byte: number) => (byte === 0 ? 256 : byte);
    return { width: side(bytes[entry]), height: side(bytes[entry + 1]) };
  });
}

describe('app icons', () => {
  test('every manifest icon is a square PNG of the size it declares', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const shipped = SHIPPED[icon.src];
      expect(shipped, `${icon.src} is not a shipped icon`).toBeDefined();
      const declared = /^(\d+)x(\d+)$/.exec(icon.sizes);
      expect(declared, `${icon.src} declares an unusable size`).not.toBeNull();
      const [, declaredWidth, declaredHeight] = declared!;
      const actual = pngSize(shipped);
      expect(actual, `${icon.src} is ${actual.width}x${actual.height}`).toEqual(
        {
          width: Number(declaredWidth),
          height: Number(declaredHeight),
        }
      );
      expect(actual.width).toBe(actual.height);
    }
  });

  test('the manifest ships a maskable icon separate from the plain one', () => {
    const maskable = manifest.icons.filter((icon) =>
      icon.purpose.includes('maskable')
    );
    const plain = manifest.icons.filter((icon) => icon.purpose.includes('any'));
    expect(maskable).toHaveLength(1);
    expect(plain.length).toBeGreaterThan(0);
    // Android crops a maskable icon to a circle, so it cannot be the artwork the
    // home screen shows: it is the same mark scaled into the safe zone. The same
    // bytes would mean no padding at all.
    expect(maskable[0].src).not.toBe(plain[0].src);
    expect(maskable512).not.toBe(icon512);
  });

  test('the apple touch icon is square and declared for iOS', () => {
    // iOS centres this on the splash screen and stretches anything non-square.
    expect(pngSize(appleTouchIcon)).toEqual({ width: 180, height: 180 });
    expect(indexHtml).toMatch(
      /<link[^>]+rel="apple-touch-icon"[^>]+sizes="180x180"[^>]+href="\/apple-touch-icon\.png"/
    );
  });

  test('every .ico frame is square', () => {
    const frames = icoSizes(faviconIco);
    expect(frames.map((frame) => frame.width).sort((a, b) => b - a)).toEqual([
      48, 32, 16,
    ]);
    for (const frame of frames) {
      expect(frame.height).toBe(frame.width);
    }
  });

  test('the tab icon is an SVG on a square canvas', () => {
    const viewBox = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(
      faviconSvg
    );
    expect(viewBox, 'favicon.svg has no viewBox').not.toBeNull();
    const [, , , width, height] = viewBox!;
    expect(Number(width)).toBe(Number(height));
  });

  test('the splash backdrop matches the icon so the mask edge is invisible', () => {
    // Android paints background_color behind the masked icon; a different colour
    // turns the mask into a visible disc.
    const fill = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(faviconSvg)?.[1];
    expect(fill?.toLowerCase()).toBe(manifest.background_color.toLowerCase());
    expect(manifest.theme_color.toLowerCase()).toBe(
      manifest.background_color.toLowerCase()
    );
  });
});
