# Promotional screenshots

Captures of the **running application** — the built Vite bundle, the shipped
stylesheet, real components — produced by `scripts/capture-promo.mjs` driving
headless Chrome over the DevTools Protocol. Nothing here is drawn by hand, and
the set is regenerable. It has two things promotional material needs:

1. **No waiting states.** Every shot waits for a readiness expression naming
   the finished content (seat marks, chart lines, booth pips, prior winners)
   and for the absence of "Awaiting", "Loading" and "Reconnecting". A capture
   cannot contain the tally animation or an empty panel.
2. **Election night, not a countdown.** `/api/config` is answered inside the
   page so the masthead reads `Polls closed · counting` (25 minutes after the
   close) while the visitor's clock is left alone, so every "2 min ago" in the
   UI stays truthful.

Light theme, 1600×1000 at 2× (3200×2000), and 390×844 at 2× for the phone
shots. Full-page variants are rendered at the final height rather than
`captureBeyondViewport`, because the latter resizes the page mid-capture and
Recharts re-measures, dropping its lines from the image.

## Data

The cycle is **2026, mock replay** (`serve-mock.ts`): the published 2026
candidates and results, staged from partial counts so the chance-of-winning
model, the count band, the count tape and the feed all have something to say.
Every name, party vote and seat winner is real; only the counting pace and the
mid-count snapshots are staged. Prior results are the **real 2023 archive**,
which is why Flipped and Past winners carry real names and margins.

The mock's `election.xml` replays the Commission's 120 _total_ seats
(electorates + list), not 120 list seats on top of the electorates. This set
shows 131 seats, because the published result has overhang: National won 42
electorates on 29% of the party vote and Te Pāti Māori won 5.

## Shots

| File                                   | Shows                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `seats-desktop` / `seats-mobile`       | Parliament hemicycle and party totals                                      |
| `electorates-map-desktop` / `-mobile`  | National map, search, General/Māori switch                                 |
| `electorates-seat-desktop` / `-mobile` | A seat open: zoomed polygon, booth pips, count band, candidate table       |
| `electorates-seat-*-full`              | The same page full length, including Past winners and the vote-share trend |
| `parties-desktop`                      | Party list rankings, list cut line                                         |
| `close-calls-desktop`                  | The tightest races on `/close-calls`                                       |
| `flipped-desktop` / `-mobile`          | Seats changing hands since 2023, prior margin beside tonight's lead        |
| `feed-desktop` / `-mobile`             | The night's event stream                                                   |
| `trends-desktop`                       | Party seat totals over time                                                |
| `trends-counted-desktop`               | The count tape (vote count progress)                                       |
| `trends-percent-desktop`               | Party vote share over time                                                 |

`manifest.json` lists the same set with titles.

## Reproducing

```bash
npm run build

# 1. Mock feed on 3557, starting at the first stage
npx tsx packages/collector/src/serve-mock.ts --year 2026 --port 3557 --stage early

# 2. Collector on 3559, publishing to the dashboard server on 3556
ELECTION_YEAR=2026 XML_FEED_BASE_URL=http://localhost:3557/ \
  POLL_INTERVAL_MS=5000 WS_URL=ws://127.0.0.1:3556 HEALTH_PORT=3559 \
  DB_PATH=.data/promo/election_results.db \
  RESULTS_CACHE_PATH=.data/promo/electorate_results.json \
  npx tsx packages/collector/src/index.ts

# 3. Dashboard server serving the built bundle
ELECTION_YEAR=2026 WS_PORT=3556 HISTORY_UPSTREAM=http://127.0.0.1:3559 \
  DIST_DIR=packages/dashboard/dist \
  CACHE_PATH=.data/promo/electorate_results.json \
  FEED_CACHE_PATH=.data/promo/feed_events.json \
  npx tsx packages/dashboard/server/index.ts

# 4. Advance the count so the tape has a few minutes of history, then capture
curl -X POST http://localhost:3557/advance     # early → mid   (~3 min in)
curl -X POST http://localhost:3557/advance     # mid   → late  (~6 min in)
node scripts/capture-promo.mjs --seat Ōtāhuhu --full
```

`--only seats,flipped` limits the set, `--viewports desktop` skips the phone
shots, and `--seat` chooses the electorate opened on the Electorates page.
`Ōtāhuhu` is this set: a seat changing hands at 63%, all three in-seat booths
counted, and a rename chain in Past winners — 2023 as Panmure-Ōtāhuhu, 2017 as
Manukau East.

Use a dedicated data directory and make sure no other collector is writing to
it: two collectors sharing one cache produce a page that disagrees with its own
feed.
