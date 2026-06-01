import { Browser } from 'puppeteer';
import { ElectorateConfig } from '@election-night/core/types';
import { log } from './logger.js';

export async function getElectoratePageHtml(
  browser: Browser,
  config: ElectorateConfig
): Promise<string> {
  log.debug(`Fetching ${config.electorateName} results`);
  const page = await browser.newPage();
  await page.goto(config.url);
  await page.waitForNetworkIdle();
  log.debug(`${config.electorateName} results successfully fetched`);
  return page.content();
}
