import { Browser } from 'puppeteer-core';
import { ElectorateConfig } from '@election-night/core/types';
import { log } from './logger.js';
import { collectorConfig } from './config.js';

export async function getElectoratePageHtml(
  browser: Browser,
  config: ElectorateConfig
): Promise<string> {
  log.debug(`Fetching ${config.electorateName} results`);
  const page = await browser.newPage();
  try {
    await page.goto(config.url, {
      timeout: collectorConfig.navigationTimeoutMs,
    });
    await page.waitForNetworkIdle({
      timeout: collectorConfig.navigationTimeoutMs,
    });
    log.debug(`${config.electorateName} results successfully fetched`);
    const content = await page.content();
    log.trace(
      `${config.electorateName}: HTML response ${(content.length / 1024).toFixed(1)}KB, preview: ${content.slice(0, 200).replace(/\s+/g, ' ')}`
    );
    return content;
  } finally {
    await page.close().catch(() => {});
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCloudflareChallenge(html: string, url: string): boolean {
  if (url.includes('__cf_chl')) return true;
  return /Just a moment|Attention Required|challenge-platform|cf-chl-widget/i.test(
    html
  );
}

/**
 * Loads one page before the scrape cycle starts and waits out the Cloudflare
 * managed challenge (if present) so a `cf_clearance` cookie lands in the
 * browser context and every electorate fetch in this cycle rides it.
 * Returns true when a real (non-challenge) page loaded within the attempts.
 */
export async function warmUpChallenge(
  browser: Browser,
  url: string,
  timeoutMs: number,
  maxAttempts: number
): Promise<boolean> {
  log.info(`Warming up challenge protection against ${url}...`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const page = await browser.newPage();
    const startedAt = performance.now();
    try {
      await page.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
      await page
        .waitForNetworkIdle({ timeout: Math.min(timeoutMs, 60_000) })
        .catch(() => {});
      const html = await page.content();
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (isCloudflareChallenge(html, page.url())) {
        log.warn(
          `Warm-up attempt ${attempt}/${maxAttempts}: still challenged after ${elapsed}s (final url: ${page.url()})`
        );
      } else {
        log.info(`Warm-up passed after ${elapsed}s (attempt ${attempt})`);
        return true;
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      log.warn(
        `Warm-up attempt ${attempt}/${maxAttempts} failed after ${((performance.now() - startedAt) / 1000).toFixed(1)}s (${detail})`
      );
    } finally {
      await page.close().catch(() => {});
    }
    if (attempt < maxAttempts) {
      await sleep(2_000);
    }
  }
  log.error(`Challenge warm-up failed after ${maxAttempts} attempts`);
  return false;
}
