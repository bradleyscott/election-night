# 2026 general election: what changed, and what it means for this app

The app was built against the 2023 cycle. It is intended to run on election
night for the **2026 general election, Saturday 7 November 2026**, and the
electoral geography has changed since 2023. This note records what changed, how
the repo absorbs it, and what to check before the night.

## What changed

The Representation Commission released the final electorate names and
boundaries on **8 August 2025**; they apply to the 2026 general election, while
any by-election held before it uses the 2020 boundaries.

|                          | 2023 | 2026   |
| ------------------------ | ---- | ------ |
| General electorates      | 65   | **64** |
| Māori electorates        | 7    | **7**  |
| Electorate seats         | 72   | **71** |
| List seats (no overhang) | 48   | **49** |

- The **North Island loses one electorate**. South Island general electorates
  are fixed at 16 by law, and the South Island's faster population growth
  pushed North Island representation from 49 to 48.
- **19 electorates are unchanged**; the boundaries of **49 general and 3 Māori
  electorates** were adjusted.
- Roughly **14% of the population** ends up in a different electorate (about
  20% of the North Island, 3% of the South Island, 0.6% of Māori electorates).
- The seven Māori electorates keep their names; three had boundary adjustments
  (Te Tai Tonga ↔ Ikaroa-Rāwhiti, and Te Tai Tonga ↔ Te Tai Hauāuru).

### Electorate changes that matter for name matching

Merged or split:

- **Ōtaki + Mana + Ōhāriu → Kapiti and Kenepuru** (the net loss of one seat)
- West Auckland: **Kelston + New Lynn + Te Atatū → Glendene, Henderson,
  Waitākere**

Renamed (2023 → 2026):

| 2023               | 2026             |
| ------------------ | ---------------- |
| Bay of Plenty      | Mt Maunganui     |
| East Coast         | East Cape        |
| Panmure-Ōtāhuhu    | Ōtāhuhu          |
| Rongotai           | Wellington Bays  |
| Wellington Central | Wellington North |
| (proposed "Rānui") | Henderson        |

So 11 of the 2023 general electorate names do not exist in 2026, and 10 new
ones appear. A map or data file keyed to the 2023 names silently produces
uncoloured electorates and clickable-but-empty polygons.

## How this repo absorbs it

**Already data-driven — nothing to do:**

- `NzElectionXmlSource` reads `electorates.xml`, `candidates.xml` and
  `parties.xml` and derives the per-electorate `e{NN}/e{NN}.xml` URLs from the
  feed's own `e_no` numbering. New names, new numbering and the drop from 72 to
  71 electorates are picked up automatically; there is no hardcoded electorate
  list in the production path.
- Seat maths is data-driven: `sainteLague(..., 120, ...)` still targets a
  120-seat parliament, and electorate wins, list seats and overhang are all
  derived from the results.

**Changed for 2026:**

1. **Boundaries are keyed by election year.**
   `packages/dashboard/public/boundaries/<year>/{general,maori}-electorates.geojson`
   plus a generated `index.json` manifest of electorate names per year.
   Regenerate with:

   ```bash
   node scripts/fetch-electorate-boundaries.mjs --year 2026
   ```

   The script pulls the final layers from Stats NZ's public ArcGIS feature
   services (no API key needed — Datafinder's export/WFS endpoints do require
   one):

   - General Electorates 2025 — 64 features
   - Māori Electorates 2025 — 7 features

   Data: Stats NZ, CC BY 4.0. Coordinates are simplified server-side with
   `maxAllowableOffset=0.0005` (~55 m), which lands at ~600 KB + ~190 KB —
   about the same weight as the 2023 files.

2. **The map picks the boundary set that matches the live results.**
   `selectBoundaryYear()` (`packages/dashboard/src/lib/electorates.ts`) scores
   each year's name list against the electorates being rendered and uses the
   best match, so running against 2023 data still draws 2023 boundaries with no
   configuration. Pin it explicitly with `VITE_ELECTION_YEAR=2026`, which also
   forces the year when the results are empty.

3. **Names are matched diacritic-insensitively.** The Commission's feed and
   Stats NZ both publish macronised names (`Ōtāhuhu`, `Māngere`, `Kaikōura`)
   and ASCII variants, so matching strips macrons, case and punctuation.

4. **Mismatches are surfaced, not hidden.** When electorates in the results
   have no polygon — or polygons have no results — the map renders a
   "Boundary mismatch" banner naming them, rather than quietly drawing the
   wrong cycle. A footer records which cycle is drawn and the Stats NZ
   attribution.

5. **History is scoped to one election cycle.** `scrape_snapshots.election_year`
   (migration `0001_absent_grey_gargoyle.sql`) records `ELECTION_YEAR` on every
   snapshot, and `/history/*` filters to the active year — otherwise a DB or
   Fly volume still holding 2023 rows would blend two cycles in the Trends
   charts. Rows written before the column existed are backfilled to `2023`.
   The JSON diff cache (`RESULTS_CACHE_PATH`) is likewise tagged with its
   cycle: a cache from another cycle is ignored, so the first scrape of the
   night no longer diffs against last election's finals and emits a burst of
   bogus feed events.

6. **The mock server can replay 2026.** `npm run start:mock -- --year 2026`
   serves 64 general + 7 Māori electorates with the new names and the 2023 ones
   gone, for an end-to-end dry run with no live feed:

   ```bash
   npm run start:mock -- --year 2026
   XML_FEED_BASE_URL=http://localhost:3457/ ELECTION_YEAR=2026 npm run start:collector
   npm run dev
   ```

   Te Pāti Māori wins the seven Māori electorates, so the replay exercises the
   overhang path — the 2026 cycle totals 125 seats against 122 in 2023.
   Electorates are served in the feed's general-then-Māori order so `e_no`
   numbering matches the real feed (general `1..64`, Māori `65..71`), and the
   mock's electorate list is asserted against the boundary manifest the map
   draws from.

## Not yet done / to verify before the night

- **Flip the year.** `ELECTION_YEAR` still defaults to `2023` in
  `packages/collector/src/config.ts`, `.env.example` and `fly.toml`. Set it to
  `2026` when the feed goes live. The boundary year follows automatically, but
  setting `VITE_ELECTION_YEAR=2026` at build time removes the guesswork.
- **The 2026 XML feed does not exist yet.**
  `https://electionresults.govt.nz/electionresults_2026/xml/` returns 404 as of
  September 2026 (the 2023 archive under `electionresults_2023/xml/` is still
  served and is what the app reads today). The Commission's media kit says the
  live results XML feed is provided to media after polls close and that access
  and testing are arranged through its media team, so confirm the election-night
  URL and schema before relying on the archive path.
- **The dev seed still uses the 2023 electorate list.** The mock server replays
  2023 by default and 2026 on request (`--year 2026`), but
  `packages/dashboard/server/seed.ts` hardcodes the 65 + 7 names, so a seeded
  dashboard shows the 2023 topology.
- **Pre-existing data on the Fly volume.** The year filter hides older rows
  rather than deleting them. Run `npm run clear` before the night if you want
  the volume clean as well.

## Sources

- [Electorate boundaries finalised — Elections NZ](https://elections.nz/media-and-news/2025/electorate-boundaries-finalised)
- [Report of the Representation Commission 2025](https://elections.nz/assets/pagecomponent-file-files/REPORT-OF-THE-REPRESENTATION-COMMISSION-2025-WEB.pdf)
- [Final electorates summary, 8 August 2025](https://elections.nz/assets/pagecomponent-file-files/Final-electorates-summary-080825.pdf)
- [From new names to new boundaries — RNZ](https://www.rnz.co.nz/news/politics/569410/from-new-names-to-new-boundaries-here-s-what-s-happening-to-your-voting-electorate)
- [Four more electorate names changed — 1News](https://www.1news.co.nz/2025/08/08/four-more-electorate-names-changed-for-next-general-election/)
- [Boundary changes shift the political landscape — The Spinoff](https://thespinoff.co.nz/the-bulletin/11-08-2025/boundary-changes-shift-the-political-landscape-ahead-of-2026)
- [General Electorates 2025 — Stats NZ](https://datafinder.stats.govt.nz/layer/122741-general-electorates-2025/)
- [Māori Electorates 2025 — Stats NZ](https://datafinder.stats.govt.nz/layer/122742-maori-electorates-2025/)
- [2026 general election media kit — Elections NZ](https://elections.nz/assets/2026-Media-Kit-/2026-General-Election-media-kit.pdf)
