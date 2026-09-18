import 'dotenv/config';
import http from 'http';
import arg from 'arg';
import {
  buildMockElectionSet,
  DEFAULT_MOCK_ELECTION_YEAR,
  isMockElectionYear,
  MOCK_ELECTION_YEARS,
  MOCK_PARTIES,
  type MockElectionYear,
} from './synthetic-electorates.js';
import type { ElectorateResults } from '@election-night/core/types';

// ---- CLI ----
//
// Parsed before any feed data is built, because the electorate list (and
// therefore every candidate, `e_no` and result) depends on the cycle.

const parsed = arg(
  {
    '--port': Number,
    '--stage': String,
    '--auto-step': Number,
    '--year': String,
    '--help': Boolean,
    '-p': '--port',
    '-y': '--year',
    '-h': '--help',
  },
  { permissive: true }
);

if (parsed['--help']) {
  console.log(`
Usage: tsx src/serve-mock.ts [options]

Serves a mock version of the Electoral Commission XML feed.

Options:
  --port, -p <number>    Listen port (default: 3457)
  --year, -y <year>      Election cycle to replay: ${MOCK_ELECTION_YEARS.join(', ')}
                         (default: ${DEFAULT_MOCK_ELECTION_YEAR}, or MOCK_ELECTION_YEAR)
  --stage <name>         Start stage: early, mid, late, full (default: early)
  --auto-step <ms>       Auto-advance stage every N milliseconds
  --help, -h             Show this message

Examples:
  # Replay the 2026 general election: 64 general + 7 Māori electorates
  npm run start:mock -- --year 2026
  XML_FEED_BASE_URL=http://localhost:3457/ ELECTION_YEAR=2026 npm run start:server
`);
  process.exit(0);
}

const yearArg = parsed['--year'] ?? process.env.MOCK_ELECTION_YEAR;
if (yearArg !== undefined && !isMockElectionYear(yearArg)) {
  console.error(
    `Unknown year "${yearArg}", valid: ${MOCK_ELECTION_YEARS.join(', ')}`
  );
  process.exit(1);
}
const ELECTION_YEAR: MockElectionYear = yearArg ?? DEFAULT_MOCK_ELECTION_YEAR;

const PORT = parsed['--port'] || Number(process.env.MOCK_PORT) || 3457;

// ---- Feed data for the selected cycle ----

const { electorates: MOCK_ELECTORATES, stages } =
  buildMockElectionSet(ELECTION_YEAR);

const STAGES: ElectorateResults[][] = [
  stages.early,
  stages.mid,
  stages.late,
  stages.full,
];
const STAGE_NAMES = ['early', 'mid', 'late', 'full'];

let currentStage = 0;

// ---- Reference data (mock parties, electorates, candidates) ----

const PARTY_INDEX = new Map(MOCK_PARTIES.map((p, i) => [p.name, i + 1]));

type CandidateRef = {
  cNo: number;
  name: string;
  eNo: number;
  pNo: number;
  listNo: number;
};

const candidates: CandidateRef[] = [];
const listCounters = new Map<string, number>();
let cNo = 0;
for (const [i, electorate] of MOCK_ELECTORATES.entries()) {
  for (const cand of electorate.candidates) {
    cNo += 1;
    let listNo = 0;
    if (cand.party) {
      const next = (listCounters.get(cand.party) ?? 0) + 1;
      listCounters.set(cand.party, next);
      listNo = next;
    }
    candidates.push({
      cNo,
      name: cand.name,
      eNo: i + 1,
      pNo: cand.party ? (PARTY_INDEX.get(cand.party) ?? 0) : 0,
      listNo,
    });
  }
}
const candidateByName = new Map(candidates.map((c) => [c.name, c]));

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

// ---- XML serialization ----
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8"?>';
}

function renderPartiesXml(): string {
  const parties = MOCK_PARTIES.map(
    (p, i) => `    <party p_no="${i + 1}">
        <abbrev>${escapeXml(p.abbrev)}</abbrev>
        <short_name>${escapeXml(p.name)}</short_name>
        <party_name>${escapeXml(p.name)}</party_name>
        <registered>yes</registered>
    </party>`
  ).join('\n');
  return `${xmlDeclaration()}\n<parties>\n${parties}\n</parties>\n`;
}

function renderElectoratesXml(): string {
  const electorates = MOCK_ELECTORATES.map(
    (e, i) => `    <electorate e_no="${i + 1}">
        <electorate_name>${escapeXml(e.name)}</electorate_name>
    </electorate>`
  ).join('\n');
  return `${xmlDeclaration()}\n<electorates>\n${electorates}\n</electorates>\n`;
}

function renderCandidatesXml(): string {
  const body = candidates
    .map(
      (c) => `    <candidate c_no="${c.cNo}">
        <candidate_name>${escapeXml(c.name)}</candidate_name>
        <electorate>${c.eNo}</electorate>
        <party>${c.pNo}</party>
        <list_no>${c.listNo}</list_no>
    </candidate>`
    )
    .join('\n');
  return `${xmlDeclaration()}\n<candidates>\n${body}\n</candidates>\n`;
}

function renderElectorateXml(results: ElectorateResults, eNo: number): string {
  const pctNumber = results.votePercentageCounted * 100;
  const pct = pctNumber.toFixed(1);

  const partyVotes = results.partyVotes
    .map((pv) => {
      const pNo = PARTY_INDEX.get(pv.candidate);
      if (!pNo) return null;
      return `        <party p_no="${pNo}">
            <votes>${pv.votes}</votes>
        </party>`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  const candidateVotes = results.candidateVotes
    .map((cv) => {
      const ref = candidateByName.get(cv.candidate);
      if (!ref) return null;
      return `        <candidate c_no="${ref.cNo}">
            <votes>${cv.votes}</votes>
        </candidate>`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  return `${xmlDeclaration()}
<electorate e_no="${eNo}" final="false" updated="${new Date().toISOString()}">
    <statistics>
        <total_voting_places_counted>${Math.round(pctNumber)}</total_voting_places_counted>
        <percent_voting_places_counted>${pct}</percent_voting_places_counted>
        <total_votes_cast>${results.votesCounted}</total_votes_cast>
        <percent_votes_cast>${pct}</percent_votes_cast>
        <total_party_informals>0</total_party_informals>
        <total_candidate_informals>0</total_candidate_informals>
        <total_registered_parties>${MOCK_PARTIES.length}</total_registered_parties>
        <total_candidates>${results.candidateVotes.length}</total_candidates>
    </statistics>
    <partyvotes>
${partyVotes}
    </partyvotes>
    <candidatevotes>
${candidateVotes}
    </candidatevotes>
</electorate>
`;
}

function renderIndex(): string {
  const links = MOCK_ELECTORATES.map((e, i) => {
    const padded = String(i + 1).padStart(2, '0');
    return `<li><a href="/e${padded}/e${padded}.xml">${escapeXml(e.name)}</a></li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Mock XML Election Results</title></head>
<body>
<h1>Mock XML Election Results</h1>
<p>Cycle: <strong>${ELECTION_YEAR}</strong> (${MOCK_ELECTORATES.length} electorates)</p>
<p>Stage: <strong>${STAGE_NAMES[currentStage]}</strong> (${currentStage + 1}/${STAGES.length})</p>
<p>Point the collector at this server (it runs inside the dashboard server):</p>
<pre>XML_FEED_BASE_URL=http://localhost:${PORT}/ ELECTION_YEAR=${ELECTION_YEAR} npm run start:server</pre>
<p>Advance: <code>curl -X POST http://localhost:${PORT}/advance</code></p>
<p>Reset: <code>curl -X POST http://localhost:${PORT}/reset</code></p>
<ul>
<li><a href="/candidates.xml">candidates.xml</a></li>
<li><a href="/parties.xml">parties.xml</a></li>
<li><a href="/electorates.xml">electorates.xml</a></li>
</ul>
<ul>
${links}
</ul>
</body>
</html>`;
}

// ---- CLI argument handling ----

const stageArg = parsed['--stage'];
if (stageArg) {
  const idx = STAGE_NAMES.indexOf(stageArg);
  if (idx !== -1) currentStage = idx;
  else
    console.error(
      `Unknown stage "${stageArg}", valid: ${STAGE_NAMES.join(', ')}`
    );
}

const autoStepMs = parsed['--auto-step'];
let autoStepTimer: ReturnType<typeof setInterval> | null = null;

function sendXml(res: http.ServerResponse, body: string) {
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(body);
}

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

  if (path === '/candidates.xml') {
    sendXml(res, renderCandidatesXml());
    return;
  }

  if (path === '/parties.xml') {
    sendXml(res, renderPartiesXml());
    return;
  }

  if (path === '/electorates.xml') {
    sendXml(res, renderElectoratesXml());
    return;
  }

  const match = path.match(/^\/e(\d+)\/e\d+\.xml$/);
  if (match) {
    const eNo = parseInt(match[1], 10);
    const electorate = MOCK_ELECTORATES[eNo - 1];
    const results = electorate ? resultsMap.get(electorate.name) : undefined;
    if (!electorate || !results || !results[currentStage]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    sendXml(res, renderElectorateXml(results[currentStage], eNo));
    return;
  }

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex());
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  console.error(`Mock server failed on port ${PORT}:`, err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(
    `Mock XML election results server listening on http://localhost:${PORT}`
  );
  console.log(`Election cycle: ${ELECTION_YEAR}`);
  console.log(
    `Stage: ${STAGE_NAMES[currentStage]} (${currentStage + 1}/${STAGES.length})`
  );
  console.log(
    `${MOCK_ELECTORATES.length} electorates, ${candidates.length} candidates`
  );
  console.log(`Feed base URL: http://localhost:${PORT}/`);
  console.log(`Advance: curl -X POST http://localhost:${PORT}/advance`);

  if (autoStepMs && autoStepMs > 0) {
    autoStepTimer = setInterval(() => {
      currentStage = (currentStage + 1) % STAGES.length;
      console.log(
        `Auto-advanced to stage: ${STAGE_NAMES[currentStage]} (${currentStage + 1}/${STAGES.length})`
      );
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

export function stopMockServer(): void {
  if (autoStepTimer) clearInterval(autoStepTimer);
  server.close();
}

export { server };
