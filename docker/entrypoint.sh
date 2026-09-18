#!/usr/bin/env bash
# Entrypoint for the combined dashboard + collector image (Option A).
#
# Runs the dashboard server (public, port 3456) and the collector (loopback,
# port 3459) in one machine so the two can talk over localhost with no
# external history hops. Set COLLECTOR_ENABLED=false to run the dashboard
# alone (used by PR previews so they never poll the live feed).
set -euo pipefail

collector_pid=""
dashboard_pid=""

node /app/server.cjs &
dashboard_pid=$!

if [ "${COLLECTOR_ENABLED:-true}" = "true" ]; then
  npx tsx /app/packages/collector/src/index.ts &
  collector_pid=$!
else
  echo "COLLECTOR_ENABLED=false — running dashboard server only"
fi

shutdown() {
  [ -n "$collector_pid" ] && kill "$collector_pid" 2>/dev/null || true
  [ -n "$dashboard_pid" ] && kill "$dashboard_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap shutdown TERM INT

# Exit as soon as either process dies so the orchestrator restarts the machine.
if [ -n "$collector_pid" ]; then
  wait -n "$dashboard_pid" "$collector_pid"
else
  wait "$dashboard_pid"
fi
shutdown
exit 1
