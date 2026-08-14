#!/bin/bash
set -e

echo "Starting web server..."
node /app/server.cjs &
SERVER_PID=$!

echo "Waiting for server to be ready..."
for i in $(seq 1 30); do
  if wget -q -O - http://localhost:3456/health > /dev/null 2>&1; then
    echo "Server is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Server failed to start within 30s"
    exit 1
  fi
  sleep 1
done

if [ "${RUN_COLLECTOR:-true}" = "true" ]; then
  echo "Starting scraper..."
  exec npx tsx /app/packages/collector/src/index.ts
fi

# Server-only mode (RUN_COLLECTOR=false): keep the web server in the
# foreground so the container stays alive without the collector.
wait $SERVER_PID
