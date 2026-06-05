import 'dotenv/config';
import http from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  earlyCountResults,
  midCountResults,
  lateCountResults,
  fullCountResults,
} from './synthetic-electorates.js';
import type { ElectorateResults } from '@election-night/core/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CSV_ELECTORATES = readFileSync(
  resolve(__dirname, '../../../csv/electorates.csv'),
  'utf-8'
)
  .trim()
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const STAGES: ElectorateResults[][] = [
  earlyCountResults,
  midCountResults,
  lateCountResults,
  fullCountResults,
];
const STAGE_NAMES = ['early', 'mid', 'late', 'full'];

let currentStage = 0;

function buildNameToResults(): Map<string, ElectorateResults[]> {
  const map = new Map<string, ElectorateResults[]>();
  for (let stage = 0; stage < STAGES.length; stage++) {
    for (const result of STAGES[stage]) {
      let list = map.get(result.electorateName);
      if (!list) {
        list = [];
        map.set(result.electorateName, list);
      }
      list[stage] = result;
    }
  }
  return map;
}

const resultsMap = buildNameToResults();

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPage(results: ElectorateResults): string {
  const candidateRows = results.candidateVotes
    .map(
      (cv) =>
        `<tr><td><span>${escapeHtml(cv.candidate)}</span><span>${cv.votes}</span></td></tr>`
    )
    .join('\n');

  const partyRows = results.partyVotes
    .map(
      (pv) =>
        `<tr><td><span>${escapeHtml(pv.candidate)}</span><span>${pv.votes}</span></td></tr>`
    )
    .join('\n');

  const pctDisplay = (results.votePercentageCounted * 100).toFixed(1);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(results.electorateName)} - Election Results</title></head>
<body>
<div id="electorate_details_partycandidate_content">
<table id="candidate_votes">
${candidateRows}
</table>
<table id="party_votes">
${partyRows}
</table>
</div>
<table id="electorate_details_table">
<tbody>
<tr>
<td></td>
<td><div>${results.votesCounted}</div></td>
<td><div>${pctDisplay}%</div></td>
</tr>
</tbody>
</table>
</body>
</html>`;
}

function renderIndex(): string {
  const links = CSV_ELECTORATES.map(
    (name, i) => `<li><a href="/electorate-details-${String(i + 1).padStart(2, '0')}.html">${escapeHtml(name)}</a></li>`
  ).join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Mock Election Results</title></head>
<body>
<h1>Mock Election Results</h1>
<p>Stage: <strong>${STAGE_NAMES[currentStage]}</strong> (${currentStage + 1}/${STAGES.length})</p>
<p>Advance: <code>curl -X POST http://localhost:${PORT}/advance</code></p>
<p>Reset: <code>curl -X POST http://localhost:${PORT}/reset</code></p>
<ul>
${links}
</ul>
</body>
</html>`;
}

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg !== -1 && args[portArg + 1] ? parseInt(args[portArg + 1], 10) : 3457;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'POST' && path === '/advance') {
    currentStage = (currentStage + 1) % STAGES.length;
    const stage = STAGE_NAMES[currentStage];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stage, index: currentStage }));
    return;
  }

  if (req.method === 'POST' && path === '/reset') {
    currentStage = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stage: STAGE_NAMES[0], index: 0 }));
    return;
  }

  if (path === '/stage') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        stage: STAGE_NAMES[currentStage],
        index: currentStage,
        total: STAGES.length,
      })
    );
    return;
  }

  const match = path.match(/^\/electorate-details-(\d+)\.html$/);
  if (match) {
    const num = parseInt(match[1], 10);
    const nameIndex = num - 1;

    if (nameIndex < 0 || nameIndex >= CSV_ELECTORATES.length) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const electorateName = CSV_ELECTORATES[nameIndex];
    const results = resultsMap.get(electorateName);
    if (!results || !results[currentStage]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const html = renderPage(results[currentStage]);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (path === '/') {
    const html = renderIndex();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Mock election results server listening on http://localhost:${PORT}`);
  console.log(`Stage: ${STAGE_NAMES[currentStage]} (${currentStage + 1}/${STAGES.length})`);
  console.log(`${CSV_ELECTORATES.length} electorates`);
  console.log(`Advance: curl -X POST http://localhost:${PORT}/advance`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
