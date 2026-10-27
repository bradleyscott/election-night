# Simplification audit

A whole-tree pass — `core`, `collector`, the dashboard server and client,
`scripts/`, and the build config — looking for code that can be deleted,
duplication that can be collapsed, and structure that costs more than it earns.

> **Status.** Tier 1 is implemented on `chore/tier1-dead-code` (~800 lines
> removed), Tier 2 on `refactor/tier2-duplication` (one tagged-cache reader, one
> concurrency limiter, one XML configuration, one seat-chance lookup, one set of
> chart helpers), Tier 3 on `refactor/tier3-structure` (wildcard exports, an
> indexed baseline lookup, one baseline injection point, `health.ts` split out
> of `static.ts`, configs ordered by `e_no`) and Tier 4 on
> `refactor/tier4-design-system` (`PartyDot`, `PageHead`/`PageWaiting`, one
> `Toggle`, one mode table in Trends). The second pass's three defects (A1–A3)
> are fixed on `fix/second-pass-defects`; its duplication, vestigial and nit
> lists are open, as are two of the original bugs.
>
> Two items were dropped deliberately. Tier 3's tag helper for `serve-mock.ts`:
> the mock's XML literals _are_ the fixture the pipeline tests compare against
> the real feed, and a helper would hide the shape to save a dozen lines. Tier
> 4's shared logo artwork: the masthead mark (`components/Logo.tsx`, brand reds,
> white backdrop, drop shadow) and the icon artwork (`scripts/generate-icons.mjs`,
> simplified orange silhouette sized for 32px) are two renderings of the same
> character built for different jobs, so one source would be a redesign of one
> of them, not a dedupe. Both copies are checked by tests that read the shipped
> files.
>
> File and line references describe the tree as it was audited, so completed
> entries point at code that has since moved or gone.

The bias is deliberate: **deletion before abstraction**. A copy that is about to
be deleted does not need unifying, and the cheapest line of code is the one that
is not there. Every "delete" below was confirmed by counting references
repo-wide, including `scripts/*.mjs` and excluding `dist/` — a symbol appearing
exactly once is a declaration nobody reads.

## How this was checked

- **Export sweep.** Every `export` in `packages/**` counted against every other
  `.ts`/`.tsx`/`.mjs` in the repo. One occurrence = dead. This is mechanical and
  was re-run against each tier rather than eyeballed.
- **Call-site tracing.** For each suspected duplication, every call site was
  read, not just the definitions — which is what separates "same shape" from
  "same thing" (`lib/history-types.ts` is a re-export, not a copy; the two
  metrics registries are split on purpose).
- **Config reality.** `package.json` `exports`, tsconfig `paths`, `vite.config`
  aliases and `dist/` contents were compared with what `src/` actually contains.
  Two of the findings below are configs that describe code which no longer
  exists.

## Tier 1 — Dead code, delete it (~800 lines)

| Item                                             | Location                                                   | Evidence                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`seed.ts`** (595 lines)                        | `packages/dashboard/server/seed.ts`                        | Nothing imports `generateSeedData` — no server, test, script or npm script. Four doc references still describe it as a working tool (see §Bugs, item 5).                                          |
| **30 alias exports + `fullCountResults`**        | `collector/src/synthetic-data.ts:265-331`                  | `landslideAt10Pct` … `tiedAt100Pct` are `fixtures[0.1]` aliases with zero call sites; `fullCountResults` likewise. The `*Fixtures` maps and the test are the real API.                            |
| **`computeSeatChanceForResult`**                 | `core/src/seat-probability.ts:597`                         | Dead wrapper. `notional-baseline.ts` calls `computeSeatChance` directly, which is the only path the app uses.                                                                                     |
| **`SPECIAL_SHARE`**, **`CERTAINTY_FLOOR`**       | `core/src/seat-probability.ts:51,128`                      | Never referenced. The floor is derived as `1 - ceiling` (`:545`). `SPECIAL_SHARE` is also a second copy of `CYCLE_CONSTANTS[2023].specialShare`.                                                  |
| **`ResultPageConfig`**                           | `core/src/types.ts:1`                                      | Unreferenced type from the HTML-scraping era.                                                                                                                                                     |
| **`useSnapshotMetas`**                           | `dashboard/src/hooks/useVoteHistory.ts:27`                 | Unreferenced hook.                                                                                                                                                                                |
| **`TimelineSeparator`**                          | `dashboard/src/components/Timeline.tsx:64`                 | Unreferenced component.                                                                                                                                                                           |
| **`BASELINE_YEARS`**                             | `dashboard/src/lib/seat-chance.ts:37`                      | Unreferenced.                                                                                                                                                                                     |
| **`core/src/index.ts` barrel + `"main"`**        | `packages/core/src/index.ts` (11 lines)                    | **Zero** imports of `@election-night/core`. All consumers deep-import subpaths (57 × `/types`, 19 × `/seat-probability`, and so on).                                                              |
| **`"./config"` export + stale `dist/config.*`**  | `packages/core/package.json`                               | `src/config.ts` is gone (it held a single unused `predictionConfidence`), but the compiled file still sits in `dist/` and the export map still points at it. A clean build leaves a broken entry. |
| **`@/` path alias**                              | `dashboard/tsconfig.json` `paths` + `vite.config.ts` alias | 0 usages of `from '@/…'`; the tree uses relative `.js` imports.                                                                                                                                   |
| **`sampleDisk` / `DiskSample`**                  | `collector/src/retention.ts:31-35`                         | Pass-through to `sampleDiskUsage` in `metrics.ts`, one caller.                                                                                                                                    |
| **`getListOpacity` (export only)**               | `dashboard/src/lib/parliament.ts:55`                       | Used only inside its own file — and its 0.2→0.8 curve is the same one `mapFillOpacity` draws for the map.                                                                                         |
| **`collector/src/fixtures.ts` + 176 KB of JSON** | `packages/collector/src/fixtures/`                         | No file imports the module. Found by re-running the export sweep after the rest of Tier 1 landed.                                                                                                 |

`NIGHT_SHARE_OF_FINAL` and `FINAL_TURNOUT` (`seat-probability.ts:42,45`) are
**not** dead — `scripts/validate-seat-probability.mjs` reads them — but they are
a second copy of `CYCLE_CONSTANTS[2023]`. See §Bugs item 4.

## Tier 2 — Collapse real duplication

### 1. Three readers for "a cycle-tagged JSON cache" (~150 lines)

- `collector/src/results.ts:47-73` (`parseCache`, the diff baseline)
- `dashboard/server/results-cache.ts` (80 lines)
- `dashboard/server/feed-cache.ts` (100 lines)

All three unpick a bare-array legacy shape, require `{ electionYear, <key> }`,
compare the year, and then **parse the JSON a second time** to explain why a
file was skipped (`describeCacheSkip` rebuilds the shape check
`extractCachedElectorates` just did). One `core/src/tagged-cache.ts` exposing
`readTagged<T>(raw, { key, expectedYear }) → { value } | { skipReason }` removes
two files and the double parse. These modules already share their types through
core; the reader belongs there too.

The cycle tag itself is not negotiable — see the comments in both files about a
volume outliving an election — so this is a consolidation, not a relaxation.

### 2. Seat-chance plumbing, four times plus one

The identical `nationalSwingOf → seatChanceFor → normalizeElectorateName` map
block appears in `pages/Seats.tsx:336-352`, `pages/Electorates.tsx:59-76`,
`pages/CloseCalls.tsx:33-49` and `pages/Flipped.tsx:55-71`. Extract
`useSeatChances(electorates, electionYear)`; the comment in `Seats.tsx` already
argues why the number must come from one call ("a row's number and the seat
page's number come from the same call"), and four independent copies is how that
promise breaks.

Related: `dashboard/server/index.ts:68` defines its own `chanceLookupFor` with
the same name and same job as `core/src/notional-baseline.ts:173`, which the
collector uses. The server cannot reach the core one because `lib/seat-chance.ts`
keeps `BASELINES` private. Expose `baselineFor(year)` (or a `chanceLookup`), and
delete the server copy — then the seat model has one entry point again instead
of one per process.

### 3. Two hand-rolled concurrency limiters, with `p-limit` already a dependency

`core/src/election-results-service.ts:120-137` and
`collector/src/voting-place-status.ts:99-118` are the same worker pool, while
`scrape-cycle.ts` uses `pLimit`. Pick one.

### 4. Other same-thing-twice, each small

| Duplication                                                                        | Where                                                                                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `toElectorateResults` vs the inline 6-field projection of the same fields          | `election-results-service.ts:104` vs `scrape-cycle.ts:146-153`                                                        |
| The `XMLParser` options object                                                     | `core/src/sources/nz-election-xml.ts:149`, `core/src/voting-places.ts:114`, `collector/src/voting-place-status.ts:68` |
| `toArray`                                                                          | named in two of those files, inlined a third time at `voting-place-status.ts:330`                                     |
| `formatClockTime` is `formatClock`                                                 | `lib/feed.ts:16` vs `lib/chart-format.ts:47`                                                                          |
| `const votes = … toLocaleString()` is `formatVotes`                                | `ElectorateStats.tsx:23` vs `lib/chart-format.ts:32`                                                                  |
| `parseTimestamp` / `parseDate` (the SQLite naive-UTC `+ 'Z'` hack)                 | `Trends.tsx:46` and `VoteHistoryChart.tsx:45`                                                                         |
| `isDarkColor` + the dark-line `strokeWidth` + `drop-shadow` block (~35 lines each) | `Trends.tsx:75,390-410` and `VoteHistoryChart.tsx:54,337-359`                                                         |
| Startup prune → compact → describe → log vs `retentionSweep()` (~45 lines)         | `collector/src/index.ts:300-345` and `:259-284`                                                                       |
| `chanceLookupFor(...)` computed twice with identical arguments                     | `collector/src/index.ts:203` and `:223`                                                                               |
| `SIGINT`/`SIGTERM` handler pairs                                                   | `collector/src/index.ts:373,380`, `dashboard/server/index.ts:305,310`                                                 |

The XML parser options are worth doing for a specific reason: the
`htmlEntities: true` flag exists because the live feed writes `O&#39;CONNOR`
where the archives write `O&apos;CONNOR`, and that bug reached the tables, map
labels and legends. Three copies of the options object is three chances to miss
it next time.

## Tier 3 — Structure that costs more than it earns

**1. `core/package.json` exports: 55 hand-maintained lines.** Thirteen entries
mirror `src/` one-for-one, so adding a module means editing a second list by
hand — and a missed entry is a runtime resolution failure, not a type error.
The `./config` entry is that bug already. Replace with `"./*":
"./dist/*.js"` plus the two genuinely irregular entries (`"./sources"` for the
nested index, `"./data/*"`), ~78 lines → ~30.

**2. `core/src/notional-baseline.ts` scans every seat, twice, per lookup.**
`priorForSeat` and `enrolmentForSeat` each normalise every seat name and walk
`Object.entries(baseline.seats)`; `seatChanceFor` calls both. On a 71-seat
payload that is roughly 10k normalisations per payload for what should be a map
lookup. Build the normalised index once (keyed off the baseline object) and the
two functions collapse into one.

**3. `lib/seat-chance.ts` is 173 lines of one-line pass-throughs**
(`priorForSeat`, `tauFor`, `nationalSwingOf`, `enrolmentForSeat`,
`seatChanceFor`), each existing only to inject `BASELINES`. Exposing the
baseline removes ~60 lines and the "which wrapper do I call" ambiguity. What is
left is genuinely dashboard-specific: `countProgress`, `mapFillOpacity`,
`formatUpdatedAgo`.

**4. `static.ts` serves four unrelated things** — `/health`, `/ready`,
`/metrics` (including the loopback merge) and the Vite bundle. `ready-check.ts`
is a module whose entire content is `ready = historyReachable` plus building a
`checks` object. Either rename the module to `http-handlers.ts` and inline
`evaluateReady`, or keep both and stop growing it.

**5. `buildConfigs()` sorts by regexing the URL it just generated**
(`nz-election-xml.ts:246-252`), though `eNo` is in hand. Trivial, but the regex
is the kind of thing that quietly stops matching.

**6. `serve-mock.ts` (864 lines)** repeats its XML templating. It is dev
tooling, so only the cheap half is worth it (a `tag(name, body)` helper); the
rest is fixture data that should stay literal.

## Tier 4 — The design system is hand-cut at the call sites

`design.md` and `styles/index.css` are in good shape, but the _markup_ that
wears the tokens is copy-pasted, which is how a token drifts.

| Pattern                            | Sites                                                                                                                                                                                                                                                                  | Proposal                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Party colour swatch                | **16**: `Seats.tsx:250,259`, `Parties.tsx:86,147`, `Trends.tsx:339`, `ParliamentTable.tsx:93,155`, `ElectorateRacesView.tsx:117,130`, `ElectorateResultsTable.tsx:74,88`, `ListCutLinesView.tsx:80,111`, `PastWinners.tsx:64`, `SortableRow.tsx:42`, `Flipped.tsx:364` | `<PartyDot size="sm" \| "md" />`. `Flipped.tsx:360` **already defines one**; export it and delete fifteen copies.              |
| Empty state + page head            | 6 pages × 2 blocks: `Parties.tsx:55/65`, `Feed.tsx:197/207`, `Flipped.tsx:138/152`, `Seats.tsx:355`, `Electorates.tsx:135/145`, `CloseCalls.tsx:106/117`, `Trends.tsx:248/265`                                                                                         | `<Page title>` rendering `pagehead` + `WaitingState`. Also removes the drift where a page's title lives in two places.         |
| Segmented mode control             | `Trends.tsx:285-345` (4 × 15 lines), `VoteHistoryChart.tsx:250-290` (4), `ElectorateDetail.tsx:52-80` (2)                                                                                                                                                              | `components/Toggle.tsx` already does exactly this and is used by `MapControls` and `CloseCalls`. ~130 lines → ~10.             |
| Mode → prefix/label/tick formatter | nested ternaries at `Trends.tsx:236,325,383` and `VoteHistoryChart.tsx:230,330`                                                                                                                                                                                        | One `CHART_MODES` table; the two chart bodies then differ only in height and label.                                            |
| Logo artwork                       | `components/Logo.tsx` (React SVG, viewBox `-44 -10 208 160`) and `scripts/generate-icons.mjs:55-70` (a re-scaled hand copy)                                                                                                                                            | Move to `src/assets/logo.svg` and have both consume it. The squashed-mascot splash came from exactly this kind of second copy. |

## Bugs and inconsistencies found on the way

These are not simplifications; they are defects the audit tripped over. Worth
tickets regardless of whether any tier is actioned.

1. **`routes.ts` has no `/api/history/voting-places/:name`.** Every voting-place
   request is labelled `route="/api/other"` in `election_http_requests_total`.
   The file exists precisely so route labels stay bounded and meaningful.
2. **`sendJson` has two opposite argument orders.** Collector:
   `(res, status, body)` (`history-server.ts:69`). Server: `(res, body, status =
200)` (`api.ts:4`). Same name, incompatible signatures, adjacent layers.
3. **Misplaced doc comments.** `seat-probability.ts:328-345`: the `priorShareFor`
   doc now sits above `canonicalParty`'s doc, so two stacked blocks describe the
   wrong function. `lib/seat-chance.ts:92`: `/** "4 min ago", "just now"… */` is
   stranded above `countProgress`.
4. ~~**The validation harness can validate stale numbers.**~~ **Fixed** in the
   second pass (A1) — the script reads `cycleConstantsFor(year)`. Its baseline
   and cache paths were also stale, so it could not run at all.
   `scripts/validate-seat-probability.mjs:27-28` imports `FINAL_TURNOUT` and
   `NIGHT_SHARE_OF_FINAL`, while the app reads `CYCLE_CONSTANTS[2023]`. The 2023
   figures are written twice in `seat-probability.ts`; update one and the
   harness reports a Brier score for a model that does not exist. Have the
   script read `cycleConstantsFor(2023)`.
5. ~~**Docs describe `seed.ts` as live.**~~ **Fixed** with the Tier 1 deletion.

## Second pass (after Tiers 1–4)

The tree was re-scanned mechanically rather than by reading: 10-line and 7-line
clone windows over every non-test file, a sweep for local symbols referenced
once, and targeted checks of the seams the refactors had moved.

### Fixed

| Defect                      | Was                                                                                                                                                       | Now                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** harness inputs       | read the baseline from `packages/dashboard/src/data/` (gone since the baselines moved), cached nothing any script writes, and imported the 2023 constants | `packages/core/data/`, the builder's `.cache/notional-<year>-files-v2.json`, `cycleConstantsFor(year)`; both reads say what is missing |
| **A2** dead route           | `/api/history/snapshots` proxied on the dashboard, with no client since `useSnapshotMetas` was deleted in Tier 1                                          | removed (the collector's route still answers the readiness probe)                                                                      |
| **A3** two feed type tables | `pages/Feed.tsx` and `components/FeedSidebar.tsx` each mapped the four event types, and disagreed: `count_completed` was "Count Complete" and "Complete"  | one `FEED_EVENT_STYLE` behind `feedEventStyle()`; `TimelineItem` takes dot classes, so both dots come from one entry                   |

### Open — duplication

- **B1. The party-list table exists twice (~90 lines).** `ListCutLinesView.tsx`
  and `pages/Parties.tsx` both render the chip row + "More…" select, the four
  column headers, the cut-line divider and the elected/`From Cut` row. They
  differ only around the table: Parties adds the electorate-leader toggle and
  links, ListCutLines shows ±3 around the cut.
- **B2. One table-header class string, 28 times, 6 files.** `Flipped.tsx`
  already has a local `Th`; generalising it (with `align`) would delete the
  literals in the six table components.
- **B3. 29 composed row-type aliases across 20 files** — 14 ×
  `type ElectorateResult = ElectorateResults & WithLeaders`, plus the
  `PartyListEntry` and `PartyVoteSummary`/`PartyEntry` equivalents. Core
  composes these three rows inside `ResultsPayload` without naming them.
- **B4. `RawElectorateResults` and `ElectorateResults` are the same shape**, so
  `toElectorateResults` (unified in Tier 2) is a key-order shuffle.
- **B5. `/api/config` is fetched up to three times on one page** — `Layout` and
  `Electorates` each call `usePollsClose`, and `useSeatChances` fetches it too;
  `useApi` has no cache or in-flight dedupe.

### Open — vestigial, needs a decision

- **C1. The `MetricEvent` payload is built, sent and discarded.** The server's
  handler reads nothing but the arrival; the collector's own registry is what
  Fly scrapes. Either the server should record it, or the collector should send
  a bare heartbeat and the union should go.
- **C2. `components.json` configures an absent tool** (no `components/ui`, no
  shadcn dependency, and its `aliases` name the `@/` path Tier 3 deleted).
  `eslint.config.js` also ignores a `components/ui` folder that never existed.
- **C3. `clsx` and `tailwind-merge` are devDependencies but imported by bundled
  `src`** (`lib/utils.ts`); a production-only install would fail the build.

### Open — nits

Two relative-time formatters (`formatUpdatedAgo`, `relativeTime`); cache-file
I/O boilerplate repeated in `server/index.ts`, `server/feed.ts` and
`collector/results.ts`; `/ready` fetches every snapshot row to test liveness;
`lib/history-types.ts` is a re-export shim; each `scripts/*.mjs` defines its own
`arg`; the root `typecheck` script builds core twice; two CI workflows repeat
the same checkout/setup block.

## What this audit deliberately left alone

- **The two metrics registries.** They are split so no series has two sources;
  the apparent duplication is the design (`docs/observability.md`).
- **`lib/history-types.ts`.** A re-export of the core contract, not a copy.
- **`feed-events.ts renderCopy`.** Long, branchy, and correctly so: it is
  editorial copy under a rule ("the number is the claim, no verdict adjective"),
  not logic that can be table-driven.
- **The `seat-probability` model itself.** The constants, pooling weight and
  clamping all carry measured justifications; there is no shorter correct form.
- **`docs/mockups/`.** Captures of the running app, not hand-drawn proposals.

## Suggested sequence

1. **Tier 1 deletions** plus the doc fixes. Pure subtraction; `lint`,
   `typecheck` and `test` should pass untouched. ~800 lines.
2. **The `exports` map and the barrel/`./config` cleanup.** Small, and it stops
   new core modules failing at runtime.
3. **The tagged-cache consolidation.** One new core module, three call sites,
   existing tests move with it.
4. **The rest of Tier 2.** Mechanical, reviewable area by area.
5. **The Tier 4 design pass.** Highest visible payoff and zero logic risk, but
   it touches ~20 files — do it alone so a visual diff is readable.
6. **The baseline index and seat-chance wrappers last.** The only change with
   performance and model surface, and the one worth a careful read.

Verification stays as it is today:

```bash
npm run lint && npm run typecheck && npm test
```

Optional add-on: `knip` as a dev dependency in `checks.yml`. This pass found
roughly fifty dead exports that a static tool would have flagged on the day each
one became dead, and it re-runs on every PR for free.
