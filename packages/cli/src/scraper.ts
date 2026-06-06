import { Browser } from 'puppeteer-core';
import { ElectorateConfig } from '@election-night/core/types';
import { log } from './logger.js';

export const NAVIGATION_TIMEOUT_MS = parseInt(
  process.env.NAVIGATION_TIMEOUT_MS || '60000',
  10
);

export async function getElectoratePageHtml(
  browser: Browser,
  config: ElectorateConfig
): Promise<string> {
  log.debug(`Fetching ${config.electorateName} results`);
  const page = await browser.newPage();
  try {
    await page.goto(config.url, { timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForNetworkIdle({ timeout: NAVIGATION_TIMEOUT_MS });
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
