import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { Server } from 'socket.io';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type {
  ResultsPayload,
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  FeedEvent,
  FeedEventType,
  ElectorateDiff,
} from '@election-night/core/types';

const PORT = parseInt(process.env.WS_PORT || '3456', 10);
const CACHE_PATH = '.cache/electorate_results.json';
const FEED_CACHE_PATH = '.cache/feed_events.json';
const DIST_DIR = process.env.DIST_DIR || resolve(process.cwd(), 'dist');
const MAX_FEED_EVENTS = 200;

type ElectorateResult = ElectorateResults & WithLeaders & WithMarginOfError;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

let latestResults: ResultsPayload | null = null;
let feedEvents: FeedEvent[] = [];

function loadCachedResults() {
  if (existsSync(CACHE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
      latestResults = {
        electorateResults: data,
        partyVote: [],
        partyLists: [],
      };
      console.log(`Loaded cached results from ${CACHE_PATH}`);
      return;
    } catch (err) {
      console.error('Failed to load cached results:', err);
    }
  }
  console.log('No cached results found, waiting for first scrape...');
}

function loadFeedEvents() {
  if (existsSync(FEED_CACHE_PATH)) {
    try {
      feedEvents = JSON.parse(readFileSync(FEED_CACHE_PATH, 'utf-8'));
      feedEvents = feedEvents.map((e: FeedEvent) => {
        if (typeof e.diff.currentMarginPercent !== 'number') {
          e.diff.currentMarginPercent = e.diff.currentVotesCounted > 0
            ? e.diff.currentMargin / e.diff.currentVotesCounted
            : 0;
        }
        return e;
      });
      console.log(`Loaded ${feedEvents.length} feed events from ${FEED_CACHE_PATH}`);
    } catch (err) {
      console.error('Failed to load feed events:', err);
      feedEvents = [];
    }
  }
}

function saveFeedEvents() {
  try {
    mkdirSync(dirname(FEED_CACHE_PATH), { recursive: true });
    writeFileSync(FEED_CACHE_PATH, JSON.stringify(feedEvents.slice(-MAX_FEED_EVENTS), null, 2));
  } catch (err) {
    console.error('Failed to save feed events:', err);
  }
}

function addFeedEvents(events: FeedEvent[]) {
  const existingIds = new Set(feedEvents.map((e) => e.id));
  const newEvents = events.filter((e) => !existingIds.has(e.id));
  if (newEvents.length === 0) return newEvents;
  feedEvents = [...feedEvents, ...newEvents].slice(-MAX_FEED_EVENTS);
  saveFeedEvents();
  return newEvents;
}

function computeDiff(
  prev: ElectorateResult | undefined,
  current: ElectorateResult
): ElectorateDiff {
  const diff: ElectorateDiff = {
    electorateName: current.electorateName,
    previousVotesCounted: prev?.votesCounted ?? null,
    currentVotesCounted: current.votesCounted,
    previousPercentageCounted: prev?.votePercentageCounted ?? null,
    currentPercentageCounted: current.votePercentageCounted,
    previousMargin: prev?.leaders.margin ?? null,
    currentMargin: current.leaders.margin,
    previousMarginPercent: prev?.leaders.marginPercent ?? null,
    currentMarginPercent: current.leaders.marginPercent ?? 0,
    leaderChanged: prev
      ? prev.leaders.leadingCandidateParty !== current.leaders.leadingCandidateParty
      : false,
    previousLeaderName: prev && prev.leaders.leadingCandidateParty !== current.leaders.leadingCandidateParty
      ? prev.leaders.leadingCandidate
      : null,
    previousLeaderParty: prev && prev.leaders.leadingCandidateParty !== current.leaders.leadingCandidateParty
      ? prev.leaders.leadingCandidateParty
      : null,
    predictionStatusChanged: prev
      ? prev.leaders.predictionStatus !== current.leaders.predictionStatus
      : false,
    previousPredictionStatus: prev?.leaders.predictionStatus ?? null,
    currentPredictionStatus: current.leaders.predictionStatus,
  };
  return diff;
}

function determineFeedType(diff: ElectorateDiff): FeedEventType {
  if (diff.leaderChanged) return 'leader_change';
  if (
    diff.previousPercentageCounted !== null &&
    diff.previousPercentageCounted < 1 &&
    diff.currentPercentageCounted >= 1
  ) {
    return 'count_completed';
  }
  if (
    diff.predictionStatusChanged &&
    (diff.currentPredictionStatus === 'likely' || diff.currentPredictionStatus === 'projected')
  ) {
    return 'prediction_called';
  }
  return 'result_updated';
}

function templateSummary(diff: ElectorateDiff, result: ElectorateResult): string {
  const l = result.leaders;
  const pct = (result.votePercentageCounted * 100).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const party = (p: string | undefined) => p ?? 'Independent';
  const moePct = (result.marginOfError * 100).toFixed(1);

  if (diff.leaderChanged) {
    return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) took the lead from ${diff.previousLeaderName} (${party(diff.previousLeaderParty)}) — leads by ${marginPct}%.`;
  }
  if (diff.previousPercentageCounted !== null && diff.previousPercentageCounted < 1 && diff.currentPercentageCounted >= 1) {
    return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) is the likely winner — ${marginPct}% lead at 100% counted.`;
  }
  if (diff.predictionStatusChanged && (l.predictionStatus === 'likely' || l.predictionStatus === 'projected')) {
    return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) is the likely winner — ${marginPct}% lead exceeds ±${moePct}% MoE, making this a confident prediction at ${pct}% counted.`;
  }
  if (diff.predictionStatusChanged && l.predictionStatus === 'leaning') {
    return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) is ahead by ${marginPct}% — but the ±${moePct}% MoE means the race is still too close to call at ${pct}% counted.`;
  }
  if (diff.previousMargin !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    if (marginDelta > 0) {
      const widenedPct = ((l.marginPercent - diff.previousMarginPercent) * 100).toFixed(2);
      return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) extended their lead by ${widenedPct}% to ${marginPct}% at ${pct}% counted.`;
    }
    if (marginDelta < 0) {
      const narrowedPct = ((diff.previousMarginPercent - l.marginPercent) * 100).toFixed(2);
      return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) leads by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`;
    }
  }
  return `${result.electorateName}: ${l.leadingCandidate} (${party(l.leadingCandidateParty)}) leads ${l.secondCandidate} (${party(l.secondCandidateParty)}) by ${marginPct}% at ${pct}% counted.`;
}

function templateCommentary(diff: ElectorateDiff, result: ElectorateResult): string {
  const l = result.leaders;
  const pct = (result.votePercentageCounted * 100).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const party = (p: string | undefined) => p ?? 'Independent';
  const moePct = (result.marginOfError * 100).toFixed(1);

  if (diff.leaderChanged) {
    return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) has taken the lead from ${diff.previousLeaderName} (${party(diff.previousLeaderParty)}) in ${result.electorateName}. The lead is ${marginPct}% with ${pct}% of votes counted.`;
  }
  if (diff.previousPercentageCounted !== null && diff.previousPercentageCounted < 1 && diff.currentPercentageCounted >= 1) {
    return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) is the likely winner in ${result.electorateName} with all ordinary votes counted.`;
  }
  if (diff.predictionStatusChanged && (l.predictionStatus === 'likely' || l.predictionStatus === 'projected')) {
    return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) is the likely winner in ${result.electorateName}. The ${marginPct}% lead exceeds the ±${moePct}% margin of error, making this a confident prediction at ${pct}% counted.`;
  }
  if (diff.predictionStatusChanged && l.predictionStatus === 'leaning') {
    return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) is ahead in ${result.electorateName} with ${marginPct}% of the vote. But a ±${moePct}% margin of error means the race is still too close to call at ${pct}% counted.`;
  }
  if (diff.previousMargin !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    if (marginDelta > 0) {
      const widenedPct = ((l.marginPercent - diff.previousMarginPercent) * 100).toFixed(2);
      return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) extended their lead by ${widenedPct}% to ${marginPct}% in ${result.electorateName} at ${pct}% counted.`;
    }
    if (marginDelta < 0) {
      const narrowedPct = ((diff.previousMarginPercent - l.marginPercent) * 100).toFixed(2);
      return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) leads in ${result.electorateName} by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`;
    }
  }
  return `${l.leadingCandidate} (${party(l.leadingCandidateParty)}) leads ${l.secondCandidate} (${party(l.secondCandidateParty)}) by ${marginPct}% in ${result.electorateName} at ${pct}% counted.`;
}

function buildFeedEvents(
  previous: ElectorateResult[],
  current: ElectorateResult[]
): FeedEvent[] {
  const events: FeedEvent[] = [];
  const prevMap = new Map(previous.map((r) => [r.electorateName, r]));

  for (const result of current) {
    const prev = prevMap.get(result.electorateName);
    const diff = computeDiff(prev, result);
    const type = determineFeedType(diff);

    const changed =
      diff.previousVotesCounted === null ||
      diff.currentVotesCounted !== diff.previousVotesCounted;

    const countCompleted =
      diff.previousPercentageCounted !== null &&
      diff.previousPercentageCounted < 1 &&
      diff.currentPercentageCounted >= 1;

    if (!changed && !diff.predictionStatusChanged && !diff.leaderChanged && !countCompleted) continue;

    events.push({
      id: `${result.electorateName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type,
      electorateName: result.electorateName,
      predictionStatus: result.leaders.predictionStatus,
      marginOfError: result.marginOfError,
      summary: templateSummary(diff, result),
      commentary: '',
      diff,
    });
  }

  return events;
}

function generateFeedCommentaries(events: FeedEvent[], results: Map<string, ElectorateResult>): FeedEvent[] {
  return events.map((event) => {
    const result = results.get(event.electorateName);
    if (!result) return event;
    return { ...event, commentary: templateCommentary(event.diff, result) };
  });
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = resolve(DIST_DIR, normalizedPath.slice(1));

  if (!resolvedPath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
    const ext = extname(resolvedPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    try {
      const content = readFileSync(resolvedPath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return;
    } catch {
      // fall through to SPA fallback
    }
  }

  // SPA fallback — serve index.html for client-side routes
  const indexPath = resolve(DIST_DIR, 'index.html');
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    const content = readFileSync(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

const server = createServer((req, res) => {
  // Let socket.io handle its own upgrade path
  if (req.url && req.url.startsWith('/socket.io')) {
    res.writeHead(426);
    res.end('Upgrade required');
    return;
  }
  serveStatic(req, res);
});

const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  if (latestResults) {
    socket.emit('results_update', latestResults);
  }
  if (feedEvents.length > 0) {
    socket.emit('feed_history', feedEvents);
  }

  socket.on('results_update', (payload: ResultsPayload) => {
    const previousResults = latestResults?.electorateResults ?? [];
    latestResults = payload;
    console.log('Received results update, broadcasting...');
    socket.broadcast.emit('results_update', payload);

    const rawEvents = buildFeedEvents(previousResults, payload.electorateResults);
    if (rawEvents.length === 0) return;

    const resultMap = new Map(payload.electorateResults.map((r) => [r.electorateName, r]));
    const eventsWithCommentary = generateFeedCommentaries(rawEvents, resultMap);
    const newEvents = addFeedEvents(eventsWithCommentary);
    if (newEvents.length > 0) {
      console.log(`Generated ${newEvents.length} feed events`);
      io.emit('feed_update', newEvents);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
  loadCachedResults();
  loadFeedEvents();
});
