import { readFileSync, existsSync } from 'fs';
import { Server } from 'socket.io';
import { createServer } from 'http';
import type { ResultsPayload } from '@election-night/core/types';

const PORT = parseInt(process.env.WS_PORT || '3456', 10);
const CACHE_PATH = '.cache/electorate_results.json';

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
    } catch (err) {
      console.error('Failed to load cached results:', err);
    }
  }
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
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
