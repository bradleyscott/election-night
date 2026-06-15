import 'dotenv/config';
import http from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import arg from 'arg';
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

function formatVotes(n: number): string {
  return n.toLocaleString('en-NZ');
}

function renderPage(results: ElectorateResults): string {
  const sortedCandidates = [...results.candidateVotes].sort(
    (a, b) => b.votes - a.votes
  );
  const leading = sortedCandidates[0];
  const second = sortedCandidates[1];
  const majority = leading ? leading.votes - (second?.votes ?? 0) : 0;

  const sortedParties = [...results.partyVotes].sort(
    (a, b) => b.votes - a.votes
  );
  const partyLead = sortedParties[0];

  const maxRows = Math.max(results.candidateVotes.length, results.partyVotes.length);

  const candidateVotesSorted = [...results.candidateVotes].sort((a, b) =>
    a.candidate.localeCompare(b.candidate)
  );
  const partyVotesSorted = [...results.partyVotes].sort((a, b) =>
    a.candidate.localeCompare(b.candidate)
  );

  let dataRows = '';
  for (let i = 0; i < maxRows; i++) {
    const cv = candidateVotesSorted[i];
    const pv = partyVotesSorted[i];
    const rowClass = i % 2 === 0 ? 'odd' : 'even';

    const candidateCell = cv
      ? `<div class="item ${rowClass}"><span>${escapeHtml(cv.candidate)}</span><span class="float-right">${cv.votes}</span></div>`
      : `<div class="item ${rowClass}"><span></span><span class="float-right"></span></div>`;

    const partyCell = pv
      ? `<div class="item ${rowClass}"><span>${escapeHtml(pv.candidate)}</span><span class="float-right">${pv.votes}</span></div>`
      : `<div class="item ${rowClass}"><span></span><span class="float-right"></span></div>`;

    dataRows += `<tr><td>${candidateCell}</td><td>${partyCell}</td></tr>\n`;
  }

  const totalCandidateVotes = results.candidateVotes.reduce((s, v) => s + v.votes, 0);
  const totalPartyVotes = results.partyVotes.reduce((s, v) => s + v.votes, 0);
  const pctDisplay = (results.votePercentageCounted * 100).toFixed(1);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(results.electorateName)} - Official Result</title></head>
<body>
<div id="wrapper">
  <div id="page">
    <div class="main-block-content">
      <div class="main-content-block">
        <div id="main_content">
          <div id="body">
            <div class="page-title">
              <h2>${escapeHtml(results.electorateName)} - Official Result</h2>
            </div>

            <table id="electorate_details_table">
              <colgroup>
                <col class="w30">
                <col class="w25">
                <col class="w15">
                <col class="w30">
              </colgroup>
              <tbody>
                <tr>
                  <td><div>VOTES COUNTED:</div></td>
                  <td><div class="bold">${formatVotes(results.votesCounted)}</div></td>
                  <td><div class="bold text-right">${pctDisplay}%</div></td>
                  <td></td>
                </tr>
                <tr><td colspan="3" class="item"></td></tr>
                ${
                  leading
                    ? `<tr><td>LEADING CANDIDATE:</td><td class="bold">${escapeHtml(leading.candidate)}</td><td class="bold text-right">${formatVotes(leading.votes)}</td><td></td></tr>`
                    : ''
                }
                ${
                  second
                    ? `<tr><td>2nd CANDIDATE:</td><td class="bold">${escapeHtml(second.candidate)}</td><td class="bold text-right">${formatVotes(second.votes)}</td><td></td></tr>`
                    : ''
                }
                <tr><td colspan="3" class="item"></td></tr>
                <tr><td>MAJORITY:</td><td></td><td class="bold text-right">${formatVotes(majority)}</td><td></td></tr>
                <tr><td colspan="3" class="item"></td></tr>
                ${
                  partyLead
                    ? `<tr><td>PARTY VOTE LEAD:</td><td class="bold">${escapeHtml(partyLead.candidate)}</td><td class="bold text-right">${(partyLead.votes / totalPartyVotes * 100).toFixed(2)}%</td><td></td></tr>`
                    : ''
                }
              </tbody>
            </table>

            <hr>
            <strong>Sort by:</strong>

            <table id="sort_by_filter_table">
              <tr>
                <td class="item"><div class="sort_by_filter_lcell"><label><input type="radio" name="sorting" value="candidate_c_sort" checked> Candidate Name </label></div></td>
                <td class="item"><div class="sort_by_filter_rcell"><label><input type="radio" name="sorting" value="party_name"> Party Name </label></div></td>
              </tr>
              <tr>
                <td class="item"><div class="sort_by_filter_lcell"><label><input type="radio" name="sorting" value="candidate_votes"> Candidate Votes </label></div></td>
                <td class="item"><div class="sort_by_filter_rcell"><label><input type="radio" name="sorting" value="party_votes"> Party Votes </label></div></td>
              </tr>
            </table>

            <div id="electorate_details_partycandidate_content">
              <div style="padding: 10px;">
                <table id="partyCandidatesResultsTable">
                  <colgroup>
                    <col class="w50">
                    <col class="w50">
                  </colgroup>
                  <thead>
                    <tr><th>Candidates</th><th>Party</th></tr>
                  </thead>
                  <tbody>
${dataRows}                    <tr>
                      <td><div class="item sub-total"><label>Candidate Informals:</label><span class="float-right">0</span></div></td>
                      <td><div class="item sub-total"><label>Party Informals:</label><span class="float-right">0</span></div></td>
                    </tr>
                    <tr>
                      <td><div class="item"><label class="bold">TOTAL:</label><span class="float-right">${formatVotes(totalCandidateVotes)}</span></div></td>
                      <td><div class="item"><label class="bold">TOTAL:</label><span class="float-right">${formatVotes(totalPartyVotes)}</span></div></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>
</div>
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

const parsed = arg({
  '--port': Number,
  '--stage': String,
  '--auto-step': Number,
  '--help': Boolean,
  '-p': '--port',
  '-h': '--help',
});

if (parsed['--help']) {
  console.log(`
Usage: tsx src/serve-mock.ts [options]

Options:
  --port, -p <number>    Listen port (default: 3457)
  --stage <name>         Start stage: early, mid, late, full (default: early)
  --auto-step <ms>       Auto-advance stage every N milliseconds
  --help, -h             Show this message
`);
  process.exit(0);
}

const PORT = parsed['--port'] || 3457;

const stageArg = parsed['--stage'];
if (stageArg) {
  const idx = STAGE_NAMES.indexOf(stageArg);
  if (idx !== -1) currentStage = idx;
  else console.error(`Unknown stage "${stageArg}", valid: ${STAGE_NAMES.join(', ')}`);
}

const autoStepMs = parsed['--auto-step'];
let autoStepTimer: ReturnType<typeof setInterval> | null = null;

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

  if (autoStepMs && autoStepMs > 0) {
    autoStepTimer = setInterval(() => {
      currentStage = (currentStage + 1) % STAGES.length;
      console.log(`Auto-advanced to stage: ${STAGE_NAMES[currentStage]} (${currentStage + 1}/${STAGES.length})`);
    }, autoStepMs);
    console.log(`Auto-step enabled: advancing every ${autoStepMs}ms`);
  }
});

function shutdown() {
  if (autoStepTimer) clearInterval(autoStepTimer);
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
