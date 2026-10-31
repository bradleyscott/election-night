/**
 * A very small Chrome DevTools Protocol client: launch headless Chrome,
 * attach to a page target, evaluate expressions, intercept one request and
 * take screenshots. No Playwright/Puppeteer dependency, and no browser in the
 * collector — this is a dev script that drives the built dashboard the same
 * way the design captures in `docs/mockups/` were produced.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function debuggingEndpoint(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function launchChrome({ port = 9333, width = 1600, height = 1000 } = {}) {
  const existing = await debuggingEndpoint(port);
  if (existing) return { browserWs: existing.webSocketDebuggerUrl, proc: null, port };

  const executable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      `No Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`
    );
  }

  const profile = mkdtempSync(path.join(tmpdir(), 'promo-chrome-'));
  const proc = spawn(
    executable,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-features=Translate,MediaRouter',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  proc.profile = profile;
  proc.on('exit', () => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    await sleep(150);
    version = await debuggingEndpoint(port);
  }
  if (!version) {
    proc.kill('SIGKILL');
    throw new Error(`Chrome did not expose a CDP endpoint on port ${port}`);
  }
  return { browserWs: version.webSocketDebuggerUrl, proc, port };
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (!msg.method) return;
      for (const handler of this.handlers.get(msg.method) ?? []) {
        handler(msg.params, msg.sessionId);
      }
    });
  }

  static async connect(browserWs) {
    const ws = new WebSocket(browserWs, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return new CDP(ws);
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
    return () => {
      const current = this.handlers.get(method) ?? [];
      this.handlers.set(
        method,
        current.filter((h) => h !== handler)
      );
    };
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** Open a page target and return a session-bound command surface. */
export async function openPage(cdp, { url = 'about:blank' } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });

  const page = {
    targetId,
    sessionId,
    send: (method, params) => cdp.send(method, params, sessionId),
    on: (method, handler) =>
      cdp.on(method, (params, sid) => {
        if (sid === sessionId) handler(params);
      }),
    async evaluate(expression) {
      const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) {
        throw new Error(
          `evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`
        );
      }
      return result?.value;
    },
    async waitFor(expression, { timeout = 30_000, label = expression } = {}) {
      const started = Date.now();
      let lastError = null;
      while (Date.now() - started < timeout) {
        try {
          if (await page.evaluate(expression)) return;
        } catch (err) {
          lastError = err;
        }
        await sleep(120);
      }
      throw new Error(
        `Timed out after ${timeout}ms waiting for ${label}` +
          (lastError ? ` (${lastError.message})` : '')
      );
    },
    async navigate(target) {
      await page.send('Page.navigate', { url: target });
      await page.waitFor(
        `document.readyState === 'complete' && !!document.querySelector('#root > *')`,
        { label: 'the app to mount' }
      );
    },
    async screenshot({ fullPage = false } = {}) {
      if (!fullPage) {
        const { data } = await page.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        return Buffer.from(data, 'base64');
      }
      const metrics = await page.send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize ?? metrics.contentSize;
      const { data } = await page.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.ceil(size.width),
          height: Math.ceil(size.height),
          scale: 1,
        },
      });
      return Buffer.from(data, 'base64');
    },
    async close() {
      await page.send('Page.close').catch(() => {});
    },
  };

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

/**
 * Answer `/api/config` in the page so the masthead reads the state a capture
 * needs. `pollsCloseAt` is recomputed per request, so the offset stays fixed
 * however long the capture run takes.
 */
export async function stubRuntimeConfig(page, { electionYear, minutesSinceClose }) {
  await page.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/config*', requestStage: 'Request' }],
  });
  page.on('Fetch.requestPaused', async ({ requestId, request }) => {
    try {
      if (/\/api\/config(?:\?|$)/.test(request.url)) {
        const body = JSON.stringify({
          electionYear,
          pollsCloseAt: new Date(
            Date.now() - minutesSinceClose * 60_000
          ).toISOString(),
          serverTime: new Date().toISOString(),
        });
        await page.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body: Buffer.from(body, 'utf8').toString('base64'),
        });
      } else {
        await page.send('Fetch.continueRequest', { requestId });
      }
    } catch (err) {
      // A target teardown mid-request is not a capture failure.
      if (!/Session closed|Target closed/.test(err.message)) throw err;
    }
  });
}

/** Light theme, motion complete rather than mid-flight. */
export const THEME_AND_MOTION_CSS = `
  :root { color-scheme: light; }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
  *, *::before, *::after {
    animation-duration: 0.001s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  .animate-pulse-live, .animate-ping, .animate-spin {
    animation: none !important;
  }
`;

export async function applyViewport(page, { width, height, dpr = 2, mobile = false }) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await page.send('Emulation.setTouchEmulationEnabled', {
    enabled: mobile,
    ...(mobile ? { maxTouchPoints: 5 } : {}),
  });
}

export async function installCaptureCss(page, css) {
  await page.evaluate(`(() => {
    const id = '__capture_style';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = ${JSON.stringify(css)};
  })()`);
}

export { sleep };
