# Prior election results: the Flipped page and past winners

Two surfaces ask the same question — _who held this seat last time?_ — and both
are served by one mechanism, `ElectionResultsService` in
`packages/core/src/election-results-service.ts`.

- **Flipped** (`/flipped`) lists seats whose previous holder's party is not the
  party leading tonight, with the previous holder's margin of victory beside
  tonight's lead and margin of error.
- **Past winners** on the electorate page lists the winner of each earlier cycle
  the archive still serves, marking the cycle a seat last changed hands.

## The service

One contract for any nominated year, live or archived:

```ts
service.getResults('2020'); // → ResultsForYear (final: true)
service.getResults('2023'); // → the live cycle, final: false
service.getPriorWinners(); // → every prior cycle, matched to today's seats
```

Design notes, and why:

- **Lazy, per year.** A cycle is ~70 small XML files (~1.6s at concurrency 10
  from the Commission's Cloudflare-cached archive). Fetching happens on the
  first request that needs a year, not at startup, so the cost is paid by the
  pages that use it. Concurrent callers share one in-flight fetch
  (single-flight).
- **Immutable once fetched.** Archived cycles never change, so an in-memory
  cache is correct and needs no invalidation. No database, no migrations, and
  none of the cycle-tagging discipline the SQLite history tables need for a
  volume that outlives an election.
- **Unavailable is reported, never substituted.** A connector that returns
  `null` for a year (the mock feed replays a single cycle) or an archive that
  404s yields `null`, which the UI renders as "prior results unavailable". A
  year is never answered with another cycle's data under the wrong label.
- **The walk stops at the first gap.** Prior years are probed newest-first and
  the first one that cannot be fetched ends the walk, so a gap cannot be skipped
  over into an older, unrelated cycle.
- **Failed years back off for 5 minutes** (`unavailableRetryMs`). The 2014 and
  earlier feeds 404; without a floor, every page load would ask again. The
  collector also retries after each scrape (`warmPriorYears()`), so a blip at
  startup does not leave the page empty until the next deploy.
- **The live cycle is not fetched twice.** The scrape loop registers its payload
  (`setLiveResults`), so `/history/results/<current year>` serves the latest
  scrape and archived years go through the identical reduction
  (`buildResultsPayload`, shared with the scrape loop).

## Endpoints

| Collector (`HEALTH_PORT`, default 3459) | Dashboard server (proxy)         |
| --------------------------------------- | -------------------------------- |
| `GET /history/results/:year`            | `GET /api/history/results/:year` |
| `GET /history/prior-winners`            | `GET /api/history/prior-winners` |

`/history/results/:year` answers `404` for a year it cannot serve (a year that
exists but is unavailable), rather than an empty `200` that would look like "no
results".

## Comparability: which seats may be compared at all

Electorate boundaries are redrawn each cycle and names change with them. A
historical comparison is only honest where the electoral area continues:

- **Comparable** — the Representation Commission records a 1:1 name change of a
  single continuing electorate. Boundary adjustments are normal and do not break
  continuity.
- **Not comparable** — new seats, and reorganisations where former electorates'
  populations are redistributed to produce the new set. Ōtaki + Mana + Ōhāriu →
  Kapiti and Kenepuru has no single prior holder, so Kapiti and Kenepuru simply
  have none. The same applies to Kelston + New Lynn + Te Atatū → Glendene,
  Henderson and Waitākere.

The rename table lives in `packages/core/src/electorate-successions.ts`, keyed
by the later cycle of each pair, with a citation per entry:

| Step      | Entries | Example                                                  |
| --------- | ------- | -------------------------------------------------------- |
| 2017→2020 | 9       | Rimutaka → Remutaka, Dunedin North → Dunedin             |
| 2020→2023 | 0       | boundaries unchanged between the two elections           |
| 2023→2026 | 5       | Bay of Plenty → Mt Maunganui, Rongotai → Wellington Bays |

Long-range comparisons compose the steps, so 2017's Rimutaka resolves to 2026's
Remutaka by way of 2020. Names that survive unchanged (including spelling-only
changes such as Whangarei → Whangārei) need no entry: every match is made on
`normalizeElectorateName`d names, which ignores macrons, case and punctuation.
That function lives in core and is re-exported by the dashboard's
`lib/electorates.ts`, so boundary matching and prior-winner matching cannot drift
apart.

Seats whose name resolves but does not exist in the target cycle are dropped, not
guessed at — a merged-away seat keeps its old name, matches nothing, and
disappears from the comparison.

### Judgement calls worth reviewing

- **Dunedin North → Dunedin** and **Dunedin South → Taieri** are included. The
  two seats became two seats and the Commission records both as name changes;
  boundaries shifted (urban Dunedin South moved to Dunedin, rural to Taieri), as
  they did for every other rename in the table. The UI names the old electorate
  (`as Dunedin North`) so a reader can judge the equivalence themselves.
- **Takanini** (new in 2020) has no prior holder, correctly.
- **Māori electorates** kept their names across all four cycles, so no entries
  are needed; three had boundaries adjusted.

## Caveats

- **The mock feed serves one cycle.** `npm run start:mock` replays either 2023 or
  2026, so pointing the collector at it reports prior results unavailable by
  design. Use the real archive for a dev run that exercises these pages:
  `ELECTION_YEAR=2023 npm run start:collector` (prior cycles 2020 and 2017).
- **Only 2020, 2017 and 2023 archives exist.** `electionresults_2014` and
  earlier 404, which is what bounds "as far back as there is XML".
- **A final count has no polling error.** Against an archive, every seat is
  100% counted, so the margin of error is 0 and every status reads "Likely
  winner". On election night the same components show the real band.
- **2017's electorates come from the feed, not the boundary files.** The
  dashboard ships boundaries for 2023 and 2026 only; prior-winner matching uses
  names, not geometry, so this needs nothing further.
