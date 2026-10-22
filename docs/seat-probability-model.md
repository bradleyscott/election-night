# Seat probability model (Tier 2)

How the app decides whether a seat can still change hands, and with what
confidence it says so. This replaces the margin-of-error heuristic currently in
`predictWinner`.

## What is being replaced, and why

`predictWinner` treats the votes counted so far as a random sample of the
eventual total and reports an interval around the current share. An election
count is an enumeration, not a sample: what is missing is specific voting places
that have not reported yet, and those places differ systematically from the ones
that have (advance votes skew differently from election-day votes; rural places
report before cities). The interval therefore has no defensible meaning — it
collapses to `±0.0%` at 100% counted and is far too narrow at 20%.

The replacement answers a different question, in three tiers:

1. **Settled** — the margin exceeds the votes that could still be cast for the
   challenger. Arithmetic, no model. (Tier 1, separate note.)
2. **Probability** — the seat is not settled, so estimate P(winner) from the
   places still to report. This document.
3. **Parliament** — distribution over the seat total, using correlated seat
   draws. Deferred; the interface here emits per-seat draws so Tier 3 can reuse
   them.

## The unit is the batch, not the voting place

A seat's results arrive as batches: one file per counted tranche, under
`e{NN}/votingplaces/`. There are **9,363 batches nationally for 2,686 voting
places** — a place can report more than once, and a seat's batches include
advance votes cast at places that stand in other electorates (Auckland Central's
2023 file counts **115 places** for a seat with 34 booths in it).

So:

- the **unit** of the model is the batch, keyed by `vp_id` plus the file name;
- a **place** contributes to a seat only through the batches filed under that
  seat;
- "places outstanding" is a count of batches not yet seen, **not** a count of
  booths in the seat's geography.

Getting this wrong is the difference between a correct interval and a
confident lie.

## Data available, and what is missing

Per batch, when it lands:

| Field | Use |
| --- | --- |
| `candidatevotes` for the seat's candidates | the outcome variable |
| `partyvotes` | cross-check only; the seat is decided on candidate votes |
| `total_issued_ballot_papers` | the batch's size |
| `time_received`, `updated` | reporting order |
| `vp_id` | joins to `votingplaces.xml` for address and coordinates |

Per seat, when it lands: `total_votes_cast`, `percent_voting_places_counted`,
`percent_votes_cast`.

Missing, and it matters:

- **The size of a batch that has not reported.** There is no published
  per-place forecast. Sizes must be modelled (below).
- **A reliable count of expected batches per seat.** `total_voting_places` is
  empty in the archives and `0` before counting starts, so it cannot be used as
  given. Instead derive it from the feed's own progress number:
  `expected ≈ batches_seen / (percent_voting_places_counted / 100)`, and only
  once that percentage is above 5.
- **Per-seat enrolment**, which would anchor the total. `statistics.xml` gives
  national electors only, so the turnout anchor is national, not local.

## Model

### 1. How many batches remain

```
seen      = number of batch files observed for this seat so far (we track names across polls)
progress  = percent_voting_places_counted / 100
expected  = seen / progress          (progress >= 0.05; otherwise unknown)
remaining = max(0, round(expected) - seen)
```

Uncertainty in `expected` is treated as Poisson-ish around the estimate; the
percentage is published to one decimal, so at 5% it is worth ±10% of the count.
Below 5% counted the seat is reported as **not yet meaningful** and no
probability is emitted at all.

### 2. How big the remaining batches are

Batch sizes are drawn from a log-normal fitted to the batches already seen **in
the same seat**, falling back to a nationally pooled fit stratified by size
decile when the seat has fewer than eight batches. The posterior is updated
each poll; the fit is not persisted.

Two guards:

- sizes are capped at the seat's largest observed batch × 3, which stops one
  anomalous early file inflating the remaining vote;
- if the seat's own batches vary by more than a factor of four, the size model is
  marked unstable and the seat's probability is suppressed (see display rules).

### 3. How the remaining votes split

For each candidate `c` in the seat, model the share of a batch's candidate votes
as a draw from a hierarchical Dirichlet:

```
θ_batch ~ Dirichlet(κ · π_stratum)
votes_batch ~ Multinomial(n_batch, θ_batch)
π_stratum ~ estimated from reported batches, partially pooled toward the seat mean
κ          ~ estimated dispersion (how much batches differ from one another)
```

Strata, in order of preference:

1. **origin** — same electorate (`vp_e_no == e_no`) or cast outside it. A batch
   whose place stands in another electorate is, by definition, an advance or
   special vote, and those carry different shares and arrive in a different
   order. **This is the only reliable type signal in the feed**: `vp_address`
   does *not* mark advance places (checked against all 2,686 addresses in the
   2026 file — the single "Advance" match is a school name, `Pacific Advance
   Secondary School`). Mobile teams (9) and care-home visits (93) are
   identifiable from the address and form their own stratum.
2. **seat** — always available.
3. **size decile** — proxy for booth size and turnout, used when origin cannot
   be resolved (a place that appears in more than one seat's batches).

The dispersion `κ` is the model's honesty dial: it is estimated, not assumed,
and it is what makes the interval widen when a seat's batches disagree with each
other. A seat whose booths all vote alike earns a narrow interval; one with a
university booth and a retirement home in the same stratum does not.

**Verification result (done):** `vp_address` does not distinguish advance
places, so count type cannot be read from the address. Origin (same electorate
vs outside) does the same job from data the feed already carries, and is
preferred for that reason.

### 4. Simulation

Per poll, per seat, 20,000 draws:

1. draw the number of remaining batches and their sizes;
2. for each, draw `θ_batch` then its votes;
3. add to the counted votes;
4. record the winner and the final margin.

Seed the generator from the scrape timestamp so every client sees identical
numbers and the result is reproducible in tests.

### 5. What it costs, measured

`scripts/bench-seat-sim.mjs` runs three implementations of the same job at the
real shape — 71 seats, 40 outstanding batches, 7 candidates, 20,000 draws per
seat:

| Implementation | Per seat | All 71 seats | 600 polls (5h at 30s) |
| --- | --- | --- | --- |
| Full multinomial per batch | 288 ms | 20.5 s | 3.4 hours |
| Per batch, leader vs challenger only | 115 ms | 8.2 s | 82 minutes |
| Aggregate Beta + size distribution | 1.9 ms | 0.13 s | 1.3 minutes |

The naive design — a full multinomial over every candidate for every batch —
is an order of magnitude too slow for a 30-second poll. Two things make the
cost disappear without changing the model:

1. **Seats settle.** A seat past the Tier 1 bound needs no simulation at all, so
   the number of simulated seats falls through the night, from 71 at 7.30pm to a
   handful by midnight.
2. **Fewer draws suffice.** Display rounds to 5%, and the Monte Carlo standard
   error at 4,000 draws is under one percentage point (`√(p(1−p)/n)` ≈ 0.8% at
   p = 0.5). 20,000 is only needed for the margin percentiles.

Recommended shape: **per batch, leader vs challenger, 4,000 draws, unsettled
seats only** — roughly 1.5 s per poll across all 71 seats, under a second once
most seats have settled, on a machine like the one measured here. On a
`shared-cpu-1x` Fly machine expect two to three times that. Ship
`election_seat_sim_duration_seconds` as a histogram and alert if it approaches
the poll interval, because that is the one thing that would silently slip a
poll.

The aggregate variant (C) is 60× cheaper again but its result depends on the
Beta prior matching the seat, which the per-batch version learns from the data.
Keep C as a documented fallback for a constrained host, not as the default.

The backtest is a batch job, not a request path: sampling 2020 and 2023 finals
down to partial coverage at 2,000 draws is a few minutes per full pass, so it
belongs in CI (nightly), not in the unit test suite.


### 6. Outputs, per seat

```
{
  settled: boolean,            // Tier 1: margin > max outstanding
  counted: number,             // batches seen / expected
  probabilities: [{ candidate, p }],   // sums to 1
  marginBand: { p10, p50, p90 },        // final margin distribution
  state: 'settled' | 'projected' | 'not-meaningful'
}
```

`p` is rounded to 0.05 before display. The raw draws are kept for Tier 3.

## Calibration, and how we know it works

There is no historical count sequence in the feed — the archives hold final
results only — so the backtest is built by **sampling the 2023 and 2020 final
place results down to partial coverage**:

1. take a seat's final batches as ground truth;
2. drop a random 40%, 60%, 80% of batches (stratified by count type);
3. run the model on the remainder;
4. score it.

Acceptance criteria, on both cycles:

| Measure | Target |
| --- | --- |
| Reliability (predicted vs observed win rate) | within 5 points in every decile |
| Brier score | < 0.12 |
| 90% interval coverage for final margin | 85–95% |
| Wrong "≥95% winner" before 50% counted | zero |

If reliability fails in the high-coverage deciles, the cause is almost always
`κ` too small (over-confident) or strata too coarse; both are tunable without
changing the structure.

## Display rules

- **Not yet meaningful** — under 5% of batches, or size model unstable. Show
  count progress only, no probability, no leader emphasis.
- **Settled** — Tier 1 bound exceeded. Show the winner and the arithmetic, with
  the special-votes caveat.
- **Projected** — show `P(winner)` as a whole-number percentage, plus the
  outstanding count. No "call" wording below 95% and 60% counted.
- Never show a probability whose 80% band spans the whole remaining range; that
  is the same as "not meaningful" and should be labelled so.

## Failure modes to watch

- **Advance skew.** If advance batches report first and lean one way, a naive
  model overstates the leader's final share. This is the largest expected error,
  and the reason count type is stratum 1.
- **Late-reporting bias.** Places that report last are not a random subset. The
  strata are a proxy, not a control.
- **Special votes.** Roughly one in six votes is special and counted after the
  night; several 2023 seats changed on them. Every probability here is a
  probability for **the night's count**, and the site must say so.
- **Size model drift.** Early batches are often small rural places; if sizes are
  modelled from them, the remaining vote is underestimated and margins look
  safer than they are. The size-decile fallback is the guard.
- **Correlated seats.** Seats share a national swing, so per-seat independence
  understates the spread of the seat total. Accepted for Tier 2; corrected in
  Tier 3.

## Decisions required

1. **Report P(winner) or a margin range?** Both are computable; the first is
   what viewers act on, the second is what forecasters trust.
2. **Origin as stratum 1** — resolved: same-electorate vs cast-outside is
   derivable from `vp_e_no` without guessing from addresses, so the model no
   longer depends on parsing place names.
3. **Suppress or widen?** When the size model is unstable, I would suppress the
   probability entirely rather than print a wide interval that reads as a shrug.
4. **Backtest data** — 2020 and 2023 archives only. Two cycles is thin; accept,
   or hold Tier 2 until after the night when 2026 becomes a third.
