import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type RowStructure = {
  rowSelector: string;
  cellSelector: string;
  cellsPerRow: number;
  candidateColumnIndex: number;
  partyColumnIndex: number;
  cellNameSelector: string;
  cellVotesSelector: string;
};

type SourceSpec = {
  resultsTableSelector: string;
  votesCountedSelector: string;
  votePercentCountedSelector: string;
  urlPattern: string;
  electorateNames: string[];
  rowStructure: RowStructure;
};

export async function runDiscover(argv: string[]) {
  let url = '';
  let outputName = 'discovered-source';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) {
      url = argv[i + 1];
      i++;
    } else if (argv[i] === '--output' && argv[i + 1]) {
      outputName = argv[i + 1];
      i++;
    }
  }

  if (!url) {
    log.error(
      'Usage: npm run scrape -- discover --url <url> [--output <name>]'
    );
    process.exit(1);
  }

  log.info(`Discovering election source from: ${url}`);
  log.info('Launching browser...');

  puppeteer.use(StealthPlugin());
  const browser = await puppeteer.launch({ headless: true });

  try {
    log.info('Fetching page HTML...');
    const html = await fetchPageHtml(browser, url);
    log.info(`Fetched ${html.length} bytes`);

    log.info('Cleaning HTML for LLM analysis...');
    const cleaned = cleanHtml(html);

    const MAX_HTML_CHARS = 100_000;
    const truncated =
      cleaned.length > MAX_HTML_CHARS
        ? cleaned.slice(0, MAX_HTML_CHARS)
        : cleaned;
    if (cleaned.length > MAX_HTML_CHARS) {
      log.warn(
        `HTML too large (${cleaned.length} bytes), truncating to ${MAX_HTML_CHARS} bytes`
      );
    }
    log.info(`HTML is ${truncated.length} bytes after cleaning/truncation`);

    log.info('Analyzing page structure with LLM...');
    const spec = await analyzeWithLLM(truncated, url);
    log.info(
      `Discovered ${spec.electorateNames.length} electorates, URL pattern: ${spec.urlPattern}`
    );

    const filePath = generateSourceFile(spec, outputName);
    log.info(`Wrote source adapter: ${filePath}`);

    if (spec.electorateNames.length > 1) {
      log.info('Validating on a second electorate page...');
      await validateSource(spec, browser);
    }

    log.info('');
    log.info('=== Success ===');
    log.info(`Source file: ${filePath}`);
    log.info('');
    log.info('To activate:');
    log.info(`  export ELECTION_SOURCE_PATH=${filePath}`);
    log.info('Then restart the scraper.');
  } catch (err) {
    log.error('Discovery failed', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

async function fetchPageHtml(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  return page.content();
}

function cleanHtml(html: string): string {
  const $ = load(html);
  $('script').remove();
  $('style').remove();
  $('nav').remove();
  $('header').remove();
  $('footer').remove();
  $('[class*="header"]').remove();
  $('[class*="footer"]').remove();
  $('[id*="cookie" i]').remove();
  $('[class*="cookie" i]').remove();
  $('[id*="banner" i]').remove();
  $('[class*="banner" i]').remove();
  $('[id*="breadcrumb" i]').remove();
  return $('body').html() ?? html;
}

function buildAnalysisPrompt(html: string, pageUrl: string): string {
  return `You are analyzing an HTML page from an election results website at: ${pageUrl}

Each page shows results for one electoral district. I need CSS selectors to extract structured data.

LOOK FOR:
1. A results table/container holding rows of candidate+vote data. Typically this has TWO columns: the left column shows candidate names + their vote counts, the right column shows party names + their vote counts.
2. Row elements within that container (typically <table> <tr> or <div> rows).
3. Each cell typically has a name in one element (e.g. <span>:first-child) and vote count in another (e.g. <span>:last-child).
4. An element showing TOTAL VOTES COUNTED.
5. An element showing PERCENTAGE OF VOTES COUNTED.
6. A DROPDOWN or LIST of all electorates with their URLs (e.g. <select id="electorates_select_box">). Use this to determine the URL pattern and all electorate names.

For the URL pattern:
- If there is a dropdown with relative URLs like "./electorate-details-01.html", construct the full URL by combining the base of the current URL with the pattern.
- Use {NN} as a placeholder for the 2-digit electorate index (01, 02, 03...).
- Use {slug} as a placeholder for electorate name slugs.
- If the URLs have different patterns, list them explicitly.

IMPORTANT: rowSelector will be searched WITHIN the resultsTableSelector container. Do NOT include the container itself in rowSelector.
Example: if resultsTableSelector is "#myTable" and rows are <tr> inside <tbody>, then rowSelector should be "tbody tr" (NOT "#myTable tbody tr").

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "resultsTableSelector": "CSS selector for the outer container that wraps all result rows (e.g. a div or table, not the innermost table)",
  "votesCountedSelector": "CSS selector for the element containing total votes counted (a number like 36403)",
  "votePercentCountedSelector": "CSS selector for the element containing percentage counted (like 100.0%)",
  "urlPattern": "URL template with {NN} or {slug} placeholder for each electorate",
  "electorateNames": ["list of ALL electorate names found in dropdown/navigation"],
  "rowStructure": {
    "rowSelector": "CSS selector for each result row RELATIVE TO the container (e.g. 'tbody tr' or just 'tr')",
    "cellSelector": "CSS selector for cells within each row (e.g. 'td', 'div.cell')",
    "cellsPerRow": "number of data cells per row (typically 2)",
    "candidateColumnIndex": "0-based index of the cell containing candidate name+votes (usually 0)",
    "partyColumnIndex": "0-based index of the cell containing party name+votes (usually 1)",
    "cellNameSelector": "CSS selector within a cell to get the name (e.g. 'span:first-child')",
    "cellVotesSelector": "CSS selector within a cell to get the vote count (e.g. 'span:last-child')"
  }
}

Here is the HTML of the page:
${html}`;
}

async function analyzeWithLLM(
  html: string,
  pageUrl: string
): Promise<SourceSpec> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.error('OPENAI_API_KEY environment variable is required');
    log.error('Set it with: export OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o';

  const prompt = buildAnalysisPrompt(html, pageUrl);

  log.info(`Calling LLM (model: ${model})...`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a DOM analysis expert. Given HTML of an election results webpage, identify CSS selectors to extract structured election data. Return ONLY valid JSON matching the requested schema.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('LLM returned empty response');
  }

  try {
    return JSON.parse(text) as SourceSpec;
  } catch {
    throw new Error(
      `Failed to parse LLM response as JSON: ${text.slice(0, 500)}...`
    );
  }
}

function generateSourceFile(spec: SourceSpec, outputName: string): string {
  const sourcesDir = resolve(__dirname, '../../core/src/sources');
  const filePath = resolve(sourcesDir, `${outputName}.ts`);

  const className = toPascalCase(outputName);

  const electorateNames = JSON.stringify(spec.electorateNames, null, 2);
  const resultsTableSelector = JSON.stringify(spec.resultsTableSelector);
  const votesCountedSelector = JSON.stringify(spec.votesCountedSelector);
  const votePercentCountedSelector = JSON.stringify(
    spec.votePercentCountedSelector
  );
  const urlPattern = JSON.stringify(spec.urlPattern);
  const rowSelector = JSON.stringify(spec.rowStructure.rowSelector);
  const cellSelector = JSON.stringify(spec.rowStructure.cellSelector);
  const rowsPerCell = spec.rowStructure.cellsPerRow;
  const candidateCol = spec.rowStructure.candidateColumnIndex;
  const partyCol = spec.rowStructure.partyColumnIndex;
  const cellNameSel = JSON.stringify(spec.rowStructure.cellNameSelector);
  const cellVotesSel = JSON.stringify(spec.rowStructure.cellVotesSelector);

  const sourceCode = [
    `import { load } from 'cheerio';`,
    `import type { ElectorateConfig, ElectionSource, RawElectorateResults, VotingResults } from '../types.js';`,
    ``,
    `export default class ${className} implements ElectionSource {`,
    `  private electorateNames = ${electorateNames};`,
    `  private urlPattern = ${urlPattern};`,
    `  private resultsTableSelector = ${resultsTableSelector};`,
    `  private votesCountedSelector = ${votesCountedSelector};`,
    `  private votePercentCountedSelector = ${votePercentCountedSelector};`,
    `  private rowSelector = ${rowSelector};`,
    `  private cellSelector = ${cellSelector};`,
    `  private cellsPerRow = ${rowsPerCell};`,
    `  private candidateColumnIndex = ${candidateCol};`,
    `  private partyColumnIndex = ${partyCol};`,
    `  private cellNameSelector = ${cellNameSel};`,
    `  private cellVotesSelector = ${cellVotesSel};`,
    ``,
    `  getElectorateConfigs(): ElectorateConfig[] {`,
    `    return this.electorateNames.map((name, index) => ({`,
    `      electorateName: name,`,
    `      url: this.buildUrl(name, index),`,
    `    }));`,
    `  }`,
    ``,
    `  private buildUrl(name: string, index: number): string {`,
    `    if (this.urlPattern.includes('{NN}')) {`,
    `      return this.urlPattern.replace(`,
    `        '{NN}',`,
    `        String(index + 1).padStart(2, '0')`,
    `      );`,
    `    }`,
    `    if (this.urlPattern.includes('{slug}')) {`,
    `      const slug = name`,
    `        .toLowerCase()`,
    `        .replace(/[^a-z0-9]+/g, '-')`,
    `        .replace(/^-|-$/g, '');`,
    `      return this.urlPattern.replace('{slug}', slug);`,
    `    }`,
    `    return this.urlPattern;`,
    `  }`,
    ``,
    `  parseRawResults(`,
    `    html: string,`,
    `    config: ElectorateConfig`,
    `  ): RawElectorateResults {`,
    `    const $ = load(html);`,
    ``,
    `    const candidateVotes: VotingResults[] = [];`,
    `    const partyVotes: VotingResults[] = [];`,
    ``,
    `    const $container = $(this.resultsTableSelector).first();`,
    ``,
    `    $container.find(this.rowSelector).each((_i, el) => {`,
    `      const $cells = $(el).find(this.cellSelector);`,
    `      if ($cells.length >= this.cellsPerRow) {`,
    `        const candidateCell = $cells.eq(this.candidateColumnIndex);`,
    `        const partyCell = $cells.eq(this.partyColumnIndex);`,
    ``,
    `        const candidateName = candidateCell`,
    `          .find(this.cellNameSelector)`,
    `          .text();`,
    `        const candidateVoteText = candidateCell`,
    `          .find(this.cellVotesSelector)`,
    `          .text();`,
    `        const partyName = partyCell`,
    `          .find(this.cellNameSelector)`,
    `          .text();`,
    `        const partyVoteText = partyCell`,
    `          .find(this.cellVotesSelector)`,
    `          .text();`,
    ``,
    `        const candidateVotesNum = parseInt(`,
    `          candidateVoteText.replace(/[,\\\\s]/g, ''),`,
    `          10`,
    `        );`,
    `        const partyVotesNum = parseInt(`,
    `          partyVoteText.replace(/[,\\\\s]/g, ''),`,
    `          10`,
    `        );`,
    ``,
    `        if (candidateName && !Number.isNaN(candidateVotesNum)) {`,
    `          candidateVotes.push({`,
    `            candidate: candidateName,`,
    `            votes: candidateVotesNum,`,
    `          });`,
    `        }`,
    `        if (partyName && !Number.isNaN(partyVotesNum)) {`,
    `          partyVotes.push({`,
    `            candidate: partyName,`,
    `            votes: partyVotesNum,`,
    `          });`,
    `        }`,
    `      }`,
    `    });`,
    ``,
    `    let votesCounted = 0;`,
    `    const votesCountedEl = $(this.votesCountedSelector).text();`,
    `    votesCounted = Number.parseFloat(`,
    `      votesCountedEl.replace(/[,\\\\s]/g, '')`,
    `    );`,
    ``,
    `    let votePercentageCounted = 0;`,
    `    const votesPctEl = $(`,
    `      this.votePercentCountedSelector`,
    `    ).text();`,
    `    votePercentageCounted =`,
    `      Number.parseFloat(votesPctEl.replace('%', '').trim()) / 100;`,
    ``,
    `    return {`,
    `      electorateName: config.electorateName,`,
    `      candidateVotes,`,
    `      partyVotes,`,
    `      votesCounted: Number.isNaN(votesCounted) ? 0 : votesCounted,`,
    `      votePercentageCounted: Number.isNaN(votePercentageCounted)`,
    `        ? 0`,
    `        : votePercentageCounted,`,
    `    };`,
    `  }`,
    `}`,
    '',
  ].join('\n');

  writeFileSync(filePath, sourceCode, 'utf-8');
  return filePath;
}

async function validateSource(
  spec: SourceSpec,
  browser: Browser
): Promise<void> {
  const secondName = spec.electorateNames[1] ?? spec.electorateNames[0];
  let secondUrl: string;

  if (spec.urlPattern.includes('{NN}')) {
    secondUrl = spec.urlPattern.replace('{NN}', String(2).padStart(2, '0'));
  } else if (spec.urlPattern.includes('{slug}')) {
    const slug = secondName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    secondUrl = spec.urlPattern.replace('{slug}', slug);
  } else {
    log.warn('Cannot construct validation URL — no {NN} or {slug} in pattern');
    return;
  }

  log.info(`Fetching validation page: ${secondUrl}`);

  try {
    const html = await fetchPageHtml(browser, secondUrl);

    const $ = load(html);
    const $container = $(spec.resultsTableSelector).first();
    const containerMatchCount = $(spec.resultsTableSelector).length;

    if (containerMatchCount === 0) {
      log.warn(`resultsTableSelector "${spec.resultsTableSelector}" matched nothing on the page`);
    } else {
      log.info(`resultsTableSelector matched ${containerMatchCount} element(s)`);
    }

    const rows: { candidate: string; party: string }[] = [];
    const rowEls = $container.find(spec.rowStructure.rowSelector);
    log.info(`rowSelector "${spec.rowStructure.rowSelector}" matched ${rowEls.length} element(s)`);

    rowEls.each((_i, el) => {
      const $cells = $(el).find(spec.rowStructure.cellSelector);
      if ($cells.length >= spec.rowStructure.cellsPerRow) {
        const candidateName = $cells
          .eq(spec.rowStructure.candidateColumnIndex)
          .find(spec.rowStructure.cellNameSelector)
          .text();
        const partyName = $cells
          .eq(spec.rowStructure.partyColumnIndex)
          .find(spec.rowStructure.cellNameSelector)
          .text();
        if (candidateName || partyName) {
          rows.push({ candidate: candidateName, party: partyName });
        }
      }
    });

    const votesCounted = $(spec.votesCountedSelector).text().trim();
    const votesPct = $(spec.votePercentCountedSelector).text().trim();

    log.info(`Validation results for "${secondName}":`);
    log.info(`  Total votes: ${votesCounted}`);
    log.info(`  Percentage counted: ${votesPct}`);
    log.info(`  Rows found: ${rows.length}`);
    log.info(
      `  First candidates: ${rows
        .slice(0, 3)
        .map((r) => r.candidate || '(empty)')
        .join(', ')}`
    );
    log.info(
      `  First parties: ${rows
        .slice(0, 3)
        .map((r) => r.party || '(empty)')
        .join(', ')}`
    );

    if (rows.length === 0) {
      log.warn(
        'No rows found in validation. The selectors may need adjustment.'
      );
    } else {
      log.info('Validation passed!');
    }
  } catch (err) {
    log.warn(`Validation page fetch or parse failed: ${err}`);
  }
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
