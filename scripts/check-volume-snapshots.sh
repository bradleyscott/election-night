#!/usr/bin/env bash
# Read-only: list the app volume's snapshots and flag any taken before the
# first post-count prune, which is where election-night's snapshot series went.
#
#   bash scripts/check-volume-snapshots.sh
#   APP=election-night VOLUME_NAME=election_data bash scripts/check-volume-snapshots.sh
#
# Needs flyctl on PATH, authenticated. Creates and changes nothing.
set -uo pipefail

APP="${APP:-election-night}"
VOLUME_NAME="${VOLUME_NAME:-election_data}"
# The count finished here (latest_state.observedAt); the first collector restart
# more than 24h after it pruned the series.
CUTOFF="${CUTOFF:-2026-11-09T08:18:32Z}"

vol_json=$(fly volumes list -a "$APP" --json 2>/dev/null) || {
  echo "fly volumes list failed — is flyctl installed and authenticated?" >&2
  exit 1
}

vol_id=$(printf '%s' "$vol_json" | VOLUME_NAME="$VOLUME_NAME" node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let j;
  try {
    j = JSON.parse(d);
  } catch {
    console.error("unparseable volume list");
    process.exit(2);
  }
  const list = Array.isArray(j) ? j : (j.volumes ?? []);
  const hit = list.find((v) => v.name === process.env.VOLUME_NAME) ?? list[0];
  if (!hit) {
    console.error("no volumes in app");
    process.exit(3);
  }
  process.stdout.write(String(hit.id ?? hit.volumeId ?? ""));
});
') || exit 1

[ -n "$vol_id" ] || {
  echo "could not resolve a volume id" >&2
  exit 1
}
echo "volume: $VOLUME_NAME ($vol_id) in $APP"
echo "snapshots at or before $CUTOFF predate the prune"
echo

snap_json=$(fly volumes snapshots list "$vol_id" -a "$APP" --json 2>/dev/null) || {
  echo "could not list snapshots (the volume may have none)" >&2
  exit 1
}

printf '%s' "$snap_json" | CUTOFF="$CUTOFF" APP="$APP" node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let j;
  try {
    j = JSON.parse(d);
  } catch {
    console.log("raw:", d.slice(0, 400));
    return;
  }
  const list = Array.isArray(j) ? j : (j.snapshots ?? []);
  if (!list.length) {
    console.log("NO SNAPSHOTS — nothing to restore.");
    return;
  }
  const rows = list
    .map((s) => ({
      id: s.id ?? s.snapshotId ?? "?",
      created: s.created_at ?? s.createdAt ?? "",
      size: s.size ?? s.sizeBytes ?? "",
    }))
    .sort((a, b) => a.created.localeCompare(b.created));

  const cutoff = Date.parse(process.env.CUTOFF);
  console.log("id".padEnd(26), "created".padEnd(26), "size");
  rows.forEach((r) => {
    const t = Date.parse(r.created);
    const flag = Number.isFinite(t) && t <= cutoff ? "  <== BEFORE THE PRUNE" : "";
    console.log(r.id.padEnd(26), r.created.padEnd(26), String(r.size), flag);
  });
  console.log();

  const usable = rows
    .filter((r) => {
      const t = Date.parse(r.created);
      return Number.isFinite(t) && t <= cutoff;
    })
    .pop();

  if (!usable) {
    console.log("None of the retained snapshots predate the prune — the series is not in them.");
    return;
  }
  console.log("Newest snapshot from before the prune:", usable.id, usable.created);
  console.log("Restore it into a throwaway app, never into " + process.env.APP + " (a second");
  console.log("machine mounting /data there would fight the running collector):");
  console.log();
  console.log("  fly apps create en-recover");
  console.log(
    "  fly volumes create election_data_recover --snapshot-id " +
      usable.id +
      " --size 1 --region syd -a en-recover"
  );
  console.log();
  console.log("Then, on a machine in en-recover with that volume at /data, run:");
  console.log("  select count(*), min(started_at), max(started_at) from scrape_snapshots;");
});
'
