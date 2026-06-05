import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, extname } from 'path';
import { Server } from 'socket.io';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { ResultsPayload } from '@election-night/core/types';
import { generateSeedData } from './seed.js';

const PORT = parseInt(process.env.WS_PORT || '3456', 10);
const CACHE_PATH = '.cache/electorate_results.json';
const DIST_DIR = process.env.DIST_DIR || resolve(process.cwd(), 'dist');

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
  console.log('No cached results found, generating seed data...');
  latestResults = generateSeedData();
  console.log(`Seed data generated with ${latestResults.electorateResults.length} electorates`);
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

  socket.on('results_update', (payload: ResultsPayload) => {
    latestResults = payload;
    console.log('Received results update, broadcasting...');
    socket.broadcast.emit('results_update', payload);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
  loadCachedResults();
});
