# Voting place data

What the Commission publishes below the seat, what it does not, and the
constraints anything built on it has to respect. Written from the 2023 and 2020
archives rather than from the documentation, because the data disagrees with the
documentation in places.

## What exists

Live cycle: `https://media.election.net.nz/xml/` (no year in the path).
Archived cycles: `https://archive.electionresults.govt.nz/electionresults_{YEAR}/xml/`.

| File                                             | Contents                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `candidates.xml`                                 | every candidate: id, name, electorate, party, list rank            |
| `parties.xml`                                    | every party: id, abbreviation, short and full name, registered     |
| `electorates.xml`                                | every seat: id and name                                            |
| `election.xml`                                   | national party vote, and the Commission's own seat allocation      |
| `statistics.xml`                                 | national totals, including voting-place counts                     |
| `votingplaces.xml`                               | one record per voting place: `vp_id`, `vp_e_no`, address, lat, lon |
| `e{NN}/e{NN}.xml`                                | one seat's totals                                                  |
| `e{NN}/votingplaces/{e_no}-{vp_e_no}{vp_no}.xml` | one **voting place result**                                        |

A voting place result (`<votingplace vp_id vp_e_no e_no vp_no>`) carries
`time_received`, a `statistics` block (`total_issued_ballot_papers`,
`total_party_informals`, `total_candidate_informals`), `partyvotes` and
`candidatevotes`. These are the units results arrive in.

Only 2020 and 2023 publish the per-place breakdown. 2017 has seat-level files
only; 2014 and earlier have no XML at all.

## Three things the field names do not tell you

### A result is not a place, and a place is not a result

2023 publishes **2,723** places in `votingplaces.xml` and **9,394** voting place
results. A place's votes can be split across several results — most commonly
because the place serves more than one electorate, and each result counts toward
one of them.

Three different place counts appear in the same cycle and none of them is wrong:

| Count  | Where it appears                              |
| ------ | --------------------------------------------- |
| 2,723  | `votingplaces.xml` entries                    |
| 3,083  | `statistics.xml` `total_voting_places`        |
| 9,394  | `statistics.xml` `total_voting_place_results` |
| 10,655 | `election.xml` `total_voting_places_counted`  |

Never treat any of them as "the denominator" without saying which one it is.

### `e_no` and `vp_e_no` are different electorates

`e_no` is the electorate the votes count toward. `vp_e_no` is the electorate the
place physically stands in. They differ for advance votes cast outside the seat.

Auckland Central's 2023 file reports **115 places counted** for a seat that
contains **34 booths**. Any claim of the form "this many polls reported in
Auckland Central" is wrong unless it says which of the two it means.

### Issued papers are not votes

`total_issued_ballot_papers` counts papers handed out at that place — including
those of voters enrolled in other seats, whose votes count elsewhere. It is an
upper bound on participation at that place, not a vote count, and it is 0 before
counting starts.

## Things the data does not contain

- **No advance-voting flag.** Among 2,686 addresses, the only "Advance" string is
  a school name. Advance places are not marked; mobile teams and care-home visits
  are, and they carry no coordinates.
- **No enrolment per seat.** `total_votes_cast` and `percent_votes_cast` are
  published, so enrolment can be derived (`votes / percent`), but it is not a
  field.
- **No electorate for Māori places.** `vp_e_no` only ever takes the 65 general
  values in 2023. No place stands in a Māori electorate, so _every_ Māori result
  is formally out-of-seat.
- **No arrival history.** The official count rewrites `time_received`: the 2023
  archive contains timestamps from 19 October and 14 November 2023, both after
  polling day. Election-night arrival order **cannot** be reconstructed from it.
- **No special votes.** `election.xml` carries `total_special_votes`, but the
  archive leaves it at 0. The special-vote estimate is a media release, not XML.

## The `vp_no` problem

The filename is `{e_no}-{vp_e_no:02}{vp_no:03}.xml`, where `vp_no` is the place's
number within its home electorate. `vp_no` is not enumerable from any published
file and it is not dense: Auckland Central's in-seat results sit in a low, gappy
range while Nelson's run 101–128 and Coromandel's 101–157.

The archive refuses directory listings (HTTP 403) and rejects unfamiliar
user-agents. Discovery is therefore by probing names — `scripts/build-notional-baseline.mjs`
probes `1..260` per seat, about 18,700 requests, and caches the responses in
`.cache/` so a repeat run costs nothing.

## Constraints on anything built from this

- **It must not enter the collector's poll loop.** The collector polls seat files
  every 30–120 seconds. The per-place detail is roughly 130× that volume. Any use
  of it must be a separate, slower path — a background job, an on-demand fetch, or
  an offline build.
- **A batch could not be summed to a seat total after the official count.** The
  official count adds special votes, so the seat total exceeds the sum of its
  voting place results. Reconcile against the night's count, not the final one.
- **Count what you mean.** Results are results, places are places, issued papers
  are issued papers. The page says "% counted"; internal notes must say which of
  the three they mean.
- **Special votes are separate.** Nothing derived from the night's count — a
  bound, a probability, a call — can be described as the result.

## What is built from it today

`scripts/build-notional-baseline.mjs` rebuilds a prior result on the _current_
cycle's boundaries, so the seat probability model has a prior for seats whose
boundaries changed. It:

1. reads each source seat's own file (`e{E}/e{E}.xml`) — the authoritative
   result, every vote the seat received, with its enrolment;
2. probes the source cycle's per-place results and keeps those whose votes are
   geographically attributable — that is, where `e_no === vp_e_no`;
3. apportions those places into the target cycle's electorate polygons by
   point-in-polygon against Stats NZ GeoJSON;
4. emits `partyShare`, `candidateShare`, `partyCandidateShare` and `enrolment`
   per seat plus a measured `tau`.

**A continuing seat takes route 1, not route 3.** Where the seat's name carries
over, its own published result is the prior: it counts every vote the seat
received, including advance votes cast at hubs in other electorates. Geometry can
only see results filed under a place standing inside the seat, and in 2023 that is
roughly half a seat's ballots — and the missing half leans National by 2.4 points
nationally. Only seats that are new or renamed (10 of 71 in 2026) are built from
geometry, and they carry `method: 'place-apportioned'` to say so; the rest carry
`method: 'same-name'`.

Its deliberate limits, in order of how much they matter:

- **Out-of-seat votes are dropped from geometry, not apportioned.** Advance votes
  cast outside a seat cannot be attributed to where the voter lives. They are not
  a random minority: they are disproportionately urban and party-organised, which
  is why seats that keep their name never use the geometry route at all.
- **Places are apportioned as whole points.** A place's voters are not spread
  across the polygon evenly, and a place near a boundary is assigned entirely to
  the seat containing its coordinates.
- **Māori seats need the name route, not the geometry route.** The filename
  encodes the home electorate, so a Māori result is `{M}-{G}{vp_no}.xml` — a name
  that cannot be enumerated from the seven Māori electorates alone, and since no
  place stands in a Māori electorate, no result file for a Māori seat is found by
  probing. They are covered instead by the same-name route: the seven names are
  unchanged between cycles, so their own previous seat result is the prior. They
  are permanently `place-apportioned`-free, and the geometry probe for them was
  not worth 18,000 more requests.
- **It is a prior, not a result.** It exists so the model can say "this seat
  started 8 points further left than the country" — a claim with an error bar, not
  a published figure.

Public pages never show the baseline. It is an input to a number, not a claim.
