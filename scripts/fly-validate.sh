#!/usr/bin/env bash
#
# Validate the XML collector in a real Fly.io environment (datacenter egress).
#
# Creates a throwaway app, attaches a volume, deploys Dockerfile.app with the
# remote builder, then checks that the collector fetched the Electoral
# Commission XML feed and published a full cycle.
#
# Usage:
#   scripts/fly-validate.sh <app-name>            # deploy + validate
#   scripts/fly-validate.sh <app-name> destroy    # tear down
#
# Env:
#   FLY_REGION   (default: syd)
#   FLY_ORG      (default: personal)
#   ELECTION_YEAR (default: 2023)
#
# Requires an authenticated flyctl (FLY_API_TOKEN or `flyctl auth login`).

set -euo pipefail

APP="${1:-}"
MODE="${2:-validate}"

if [ -z "$APP" ]; then
  echo "Usage: $0 <app-name> [destroy]" >&2
  exit 1
fi

REGION="${FLY_REGION:-syd}"
ORG="${FLY_ORG:-personal}"
YEAR="${ELECTION_YEAR:-2023}"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [ "$MODE" = "destroy" ]; then
  echo "==> destroying $APP"
  flyctl apps destroy "$APP" -y || true
  exit 0
fi

if ! flyctl auth whoami >/dev/null 2>&1; then
  echo "ERROR: flyctl is not authenticated. Run 'flyctl auth login' or set FLY_API_TOKEN." >&2
  exit 1
fi

echo "==> app: $APP  region: $REGION  election year: $YEAR"
flyctl apps create "$APP" --org "$ORG" 2>/dev/null || echo "   (app already exists)"

echo "==> volume: election_data (1GB, $REGION)"
flyctl volumes create election_data \
  --app "$APP" --region "$REGION" --size 1 --yes 2>/dev/null \
  || echo "   (volume already exists)"

echo "==> deploying with the remote builder"
flyctl deploy \
  --app "$APP" \
  --remote-only \
  --ha=false \
  --build-arg "GIT_SHA=$GIT_SHA" \
  --env "ELECTION_YEAR=$YEAR"

echo "==> ensuring a public IP"
flyctl ips allocate-v4 --shared --app "$APP" 2>/dev/null || true
flyctl ips allocate-v6 --app "$APP" 2>/dev/null || true

echo "==> status"
flyctl status --app "$APP"

URL="https://$APP.fly.dev"

echo "==> waiting for $URL/health"
for _ in $(seq 1 36); do
  if curl -fsS --max-time 5 "$URL/health" >/dev/null 2>&1; then
    echo "   health OK"
    break
  fi
  sleep 5
done

echo "==> /health"
curl -sS --max-time 10 "$URL/health" || true
echo
echo "==> /ready"
curl -sS --max-time 20 "$URL/ready" || true
echo

echo "==> /metrics (server series + merged collector series)"
# The collector metrics only appear after its first cycle, so retry briefly.
for _ in $(seq 1 12); do
  METRICS="$(curl -sS --max-time 10 "$URL/metrics" || true)"
  if printf '%s' "$METRICS" | grep -q '^election_votes_counted'; then break; fi
  sleep 5
done
printf '%s\n' "$METRICS" | grep -E '^election_(http_requests_total|build_info|collector_metrics_reachable|votes_counted)' || true
if ! printf '%s' "$METRICS" | grep -q '^election_votes_counted'; then
  echo "ERROR: collector metrics were not merged into /metrics" >&2
  exit 1
fi
echo

echo "==> capturing 90s of logs to check the XML cycle"
LOG="/tmp/fly-$APP.log"
: > "$LOG"
flyctl logs --app "$APP" > "$LOG" 2>&1 &
LOGPID=$!
sleep 90
kill "$LOGPID" 2>/dev/null || true
pkill -f "flyctl logs --app $APP" 2>/dev/null || true

echo
echo "==> collector evidence"
grep -E "SOURCE:|ELECTION_YEAR:|Loaded XML source|Finished with|Party votes|Top 3|fetch failed|HTTP [0-9]+|ERROR" "$LOG" | head -40 \
  || echo "   (no matching lines yet — check $LOG)"

echo
echo "Done. Tear down with:"
echo "  $0 $APP destroy"
