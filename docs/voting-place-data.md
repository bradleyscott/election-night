# Voting-place data: what the subfolders under each electorate contain

Handover note for whoever builds on this. It records only what has been
verified against the live feed; where something is unverified it says so.

## The files

The Commission's XML feed publishes a per-place breakdown under every
electorate directory:

```
xml/
  candidates.xml  parties.xml  electorates.xml  election.xml  statistics.xml
  votingplaces.xml                      # every voting place: id, address, lat/lon
  e01/
    e01.xml                             # the seat's totals
    votingplaces/
      01-01001.xml                      # one batch of counted votes
      01-01002.xml
      …
```

- `votingplaces.xml`: **2,686 voting places** nationally, fields `vp_id`,
  `vp_e_no`, `vp_address`, `vp_lat`, `vp_lon`. **2,524 carry coordinates**
  (94%); the rest are mobile teams and care-home visits with empty lat/lon.
- `e{NN}/votingplaces/{EE}-{NNNNN}.xml`: **9,363 batches nationally**. Each has
  `vp_id`, `vp_e_no`, `e_no`, `vp_no`, `updated`, `time_received`,
  `statistics` (`total_issued_ballot_papers`, informals), `partyvotes`,
  `candidatevotes`.

## The four things that are easy to get wrong

**1. A batch is not a place.** 9,363 batches for 2,686 places: a place can report
more than once, and batches are the unit results arrive in. Counting files as
"places reported" overstates progress.

**2. `e_no` and `vp_e_no` are different electorates.** `e_no` is the electorate
the result counts toward; `vp_e_no` is the electorate the place physically
stands in. Auckland Central's 2023 seat file reports **115 voting places** while
only 34 booths stand in the seat: the rest are advance votes cast elsewhere,
counted toward the voter's electorate. So:

- the folder says *whose votes these are*, not *where they were cast*;
- a seat's batches include places from all over the country;
- "how did this booth vote" is only answerable for places where
  `vp_e_no == e_no`.

**3. `issued ballots` ≠ votes, and it is zero before counting.** Do not treat
`total_issued_ballot_papers` as the seat's vote total, and do not divide by it
before counting starts. It is an upper bound on how many papers were handed out
at that place, including voters enrolled elsewhere.

**4. Advance places are not marked in the data.** `vp_address` distinguishes
mobile teams (9) and care homes (93), but **not advance places** — the only
"Advance" string in all 2,686 addresses is a school name. The reliable signal is
origin: `vp_e_no != e_no` means the batch was cast outside the seat.

## What is worth building, in order

**A. Remaining-vote estimator for close seats.** For each close seat: current
margin, batches still to report, and `total_issued_ballot_papers` at the places
not yet counted. If the margin exceeds the outstanding papers, the seat cannot
change on the night — arithmetic, no model.

**B. Seat composition ("where this seat's votes came from").** Split a seat's
batches into cast-inside vs cast-elsewhere, with Σ batches = the seat total as a
visible reconciliation check.

**C. Count-progress map.** One dot per voting place, filled once reported.
Cheap, mostly presentational.

**D. Local swing across cycles.** Place-level 2023 → 2026 comparison. Only where
the same place reported in both cycles; everything else is reported as not
comparable, never guessed.

There is a full design note for a probabilistic version of A in
`docs/seat-probability-model.md`, and comps for all four in `docs/mockups/`
(`places-progress`, `electorate-batches`, `local-swing`, `flip-watch`,
`flip-toggle`, `electorate-probability`).

## Non-goals / things not to do

- **Do not fetch 9,363 files per poll.** At a 30-second cadence that is abusive
  and pointless. Fetch one electorate's batches on demand (~69 files, 1–2 s at
  concurrency 10) and cache them in memory for the process with a short TTL.
- **Do not put this in the collector's scrape loop.** The collector polls the
  seat files; the place detail is a read path, not a scrape path.
- **Do not map a batch to a booth result** unless `vp_e_no == e_no`.
- **Do not compare places across cycles** on name or address alone. `vp_id` is
  the join key and its stability across cycles is **unverified** — check before
  relying on it, and report mismatches as not comparable.
- **Do not treat a "settled" seat as final.** Special votes are counted after
  the night and changed several seats in 2023.

## Archive coverage

`votingplaces.xml` and the batch files exist for the **2023 and 2020** archives
at `https://archive.electionresults.govt.nz/electionresults_{YEAR}/xml/`.
2017 and earlier: seat-level XML only. 2014 and earlier: no XML at all.

## Fixtures

`packages/core/src/sources/fixtures/votingplaces/` holds real files for test
work, not hand-written samples:

| File | What it pins |
| --- | --- |
| `2023-e01-batch.xml` | a real counted batch: votes present, `time_received` populated |
| `2026-e01-batch.xml` | the pre-election state: same schema, every count zero, `time_received` empty |
| `2023-e01-seat.xml` | a final seat file: `115` places counted for a seat with 34 booths |
| `2026-election.xml` | the national party status and seat table |

Use them as-is: the zero-count file and the counted file differ only in values,
which is exactly the transition the code has to survive.

## Open questions

1. Is `vp_id` stable across cycles? Unknown; check against 2020 and 2023
   `votingplaces.xml` before building D.
2. Does `time_received` fill in during live counting? It is populated in the
   archive and empty pre-election, so presumably yes — unverified live.
3. Per seat, is `total_voting_places` usable? It is empty in the archives and
   `0` before counting. Derive the expected batch count from
   `batches_seen / percent_voting_places_counted` instead.
