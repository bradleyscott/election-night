# Seat probability model

The electorate page shows one number beside a seat that is still counting: the
chance the candidate currently leading goes on to win it. This document says
what that number is, where every constant comes from, and what it cannot know.

The number is not a forecast. It is a statement about **tonight's count**: given
the votes already in, the votes still to come, and how the votes still to come
have been behaving, does the leader's margin survive? Special votes are counted
after election night and are not in this number. A seat at 99% is close to
certain _on the night's count_; the official result can still differ.

Code: `packages/core/src/seat-probability.ts`. Wiring: `packages/dashboard/src/lib/seat-chance.ts`.

## Why not margin of error

The field this replaces (`marginOfError`) is a sampling error: the uncertainty of
a survey of a population. A count is not a sample. Once a vote is counted it is
exact, and the remaining uncertainty is not sampling error but **which votes have
not arrived yet**. A seat 4,000 ahead with 95% counted has almost no uncertainty;
a seat 300 ahead with 40% counted has a great deal. Margin of error cannot tell
those apart — it responds to _how many_ votes are counted, not _which ones are
missing_ — so it reads "safe" or "unsafe" and barely moves as the night
progresses. It is a threshold wearing a percentage's clothes.

## The three quantities

1. **How many votes tonight will count.** Unknown directly; recovered from
   turnout.
2. **Where those outstanding votes will go.** Estimated from the seat's own
   prior result, moved by the swing observed nationally tonight, and from how the
   seat has been deviating from that swing so far.
3. **What margin that could overturn.** The probability is the chance a margin of
   the observed size survives a swing of the estimated size.

## 1. How many votes are still out

The feed gives `total_votes_cast` (votes counted so far) and `percent_votes_cast`
(turnout: votes counted ÷ enrolled). Enrolment is the denominator we need. It is
not published per seat in the XML — `statistics.xml` carries only a national
`total_electors` — so each seat's roll is carried in the baseline, recovered once
from the source cycle's own seat file (`total_votes_cast ÷ percent_votes_cast`).
Where no recorded roll exists the model still falls back to that division, and
that fallback is only trustworthy later in the night, because the percentage is
published to one decimal place: 200 votes at "0.4%" implies 50,000 enrolled
against a true 45,407.

```
enrolment         = recorded, else total_votes_cast / percent_votes_cast
expected_night    = enrolment × turnout × nightShare      (cycle's own figures)
remaining_turnout = max(0, expected_night − total_votes_cast)
remaining_places  = ((1 − p) ÷ p) × total_votes_cast      (p = places counted)
remaining         = max(remaining_turnout, remaining_places)
progress          = total_votes_cast ÷ (total_votes_cast + remaining)
```

`turnout` and `nightShare` are **per cycle**, not one number for all of them:
turnout was 78.9% in 2017, 81.9% in 2020 and 77.7% in 2023, and the night's share
of the final count was 0.838, 0.821 and 0.783. A cycle with no published figures
yet (2026 today) inherits the newest one and is marked `assumed`: specials have
risen every cycle, so carrying them forward overstates the night's total, which
makes the model think more is still out and close seats late rather than early.
That assumption also scales the size uncertainty by 1.6.

`percent_voting_places_counted` is **never read as progress**. It enters the
model twice, both times as the one signal that cannot be wrong the way the
turnout estimate can, because it counts a closed set: a place either has a
result or it does not.

- **A floor under the votes still to come.** Votes per place so far, applied to
  the places that have not reported: the `remaining_places` term above, and the
  larger of the two terms wins. It can only ever raise the estimate of what is
  out, so place data can never make a seat look more finished than the turnout
  estimate does — only less finished, or unchanged.
- **The test for whether counting has finished.** At 100% of places, and not
  before.

Reading it as a share of the vote is the mistake the floor exists to avoid.
Measured on the 2023 archive's per-place results:

- The 65 general seats publish 7,124 place entries: 2,625 booths holding 1.86M
  votes (707 each) and 4,499 advance-hub slices holding 387k (86 each). **63% of
  the entries a seat lists hold 17% of its votes**, and they are the entries that
  report first.
- Place sizes are unequal even within one class: median coefficient of variation
  **1.34** per seat (Gini 0.61), the biggest booth in a seat holding a median
  **17%** of that seat's in-seat vote, up to 33%.
- Random-order error of the naive shortcut at the halfway point: median **8.1
  points**, 90th percentile 19, worst 35, with the estimate of what is out off by
  more than 1.5× in 40% of cases.
- In the order results actually arrive, the bias is worse than the noise. At the
  moment the advance block lands a seat reads a median **71% of places reported
  against 16% of votes counted**, so "still out" would be understated about
  twelvefold.

So the floor binds late, when the turnout estimate says the night is over but a
few large booths have not reported, and the turnout estimate binds early, when
the reported places are the tiny advance slices. Neither is authoritative alone.

### The trap this model exists to avoid

`percent_votes_cast` at the end of the official count **includes special
votes**. Using that number as the night's denominator stalls progress at about
79% forever and keeps manufacturing comebacks after midnight: the model believes
20% of the vote is still arriving when the night's count is finished. So the
night's total is the final total scaled down by the share of votes that are
ordinary (counted on the night):

- 2017: 2,179,668 ordinary of 2,602,689 → 0.838, specials 17.2%.
- 2020: 504,625 specials (17.4%) → 0.821.
- 2023: 2,244,380 ordinary of 2,867,478 → 0.783, specials 603,257 (21.0%).

Specials have grown every cycle, so the 2023 figure is the one to carry forward
when a new cycle has no numbers yet.

## 2. Where the outstanding votes go

The seat's prior result does not exist on the current boundaries — boundaries are
redrawn most cycles, and 2026 retired 11 seats and renamed 10. It is rebuilt from
the previous cycle's **voting-place results**, geolocated and apportioned onto the
current boundaries. That is `scripts/build-notional-baseline.mjs`, and
`docs/voting-place-data.md` explains its limits.

That gives, per seat, the previous result as if it had been fought on today's
boundaries: `partyShare`, `candidateShare` and `partyCandidateShare` per party
and candidate, plus the seat's `enrolment`.

Two details matter more than they look:

- **A continuing seat uses its own published result, not its places.** Geometry
  can only see results filed under a place standing inside the seat, and under
  2023 conditions that is about half a seat's ballots — the missing half is
  advance voters, who voted at hubs in other electorates and lean measurably
  differently. So wherever the seat's name carries over, the baseline takes the
  seat's own previous result, and geometry is used only for the 10 seats that
  are new or renamed in 2026. `method` records which route each seat took.
- **Parties, not people, are the unit.** A candidate is an avatar of their
  party, so `partyCandidateShare` — the party's share of the _candidate_ vote —
  is the prior a projection wants. A party that stands a new candidate inherits
  its own prior; only a party with no candidate last time is provisional.
  Party names are canonicalised (`canonicalParty`) because the feed writes
  "National Party" where a fixture writes "National", and a lookup that misses
  silently returns zero support.

### Swing

Raw national swing is not used on its own, because it erases the seat: a seat
that is 15 points more conservative than the country stays that way. The
expected share of the votes still to come is

```
expected(seat) = prior(seat) + national_swing + seat_deviation
```

- `national_swing` is measured from the seats counted so far tonight by
  `computeObservedSwing`, vote-weighted. It needs no published national table,
  and it self-corrects: early in the night the sample is advance-heavy, and as
  booths report it converges on the country.
- `seat_deviation` is how far the seat has run from that swing so far — shrunk
  towards zero, because a few thousand votes in one seat are not enough to
  establish a local trend.

### Shrinkage

```
composition = τ × (1 − progress) × COMPOSITION_STRENGTH
weight      = τ² / (τ² + s(1 − s)/n + composition²)   // s = observed, n = cast
deviation   = (observed_share − prior_share − national_swing) × weight
```

The `composition` term is not statistics — it is a correction for the fact that
an early count is not a random sample of the seat. Votes arrive in blocks:
advance votes first, then booths. Measured on the 2020 and 2023 archives, votes
cast away from home differ from the seat's own count by a mean absolute 4.3–7.9
percentage points of margin, and the direction of that difference **reverses**
between cycles — so it is carried as uncertainty, not as a bias correction.
Without the term, sampling noise alone lets 2,000 early votes outvote the prior
by 25:1.

`τ` is the standard deviation of seat-level deviation from uniform national
swing — how much seats genuinely differ from the country. It is **measured** from
the archives (the sd of each seat's maximum absolute deviation across a
transition) and stored in the baseline file. Where no measurement exists the
fallback is `DEFAULT_TAU = 0.03`. Using a measured value matters: too large and
every early result looks meaningful; too small and the model ignores real local
trends for hours.

`weight → 1` as `n` grows, and `→ 0` as the seat's count is small, so an early
snapshot moves the estimate a little and a mature one moves it a lot.

## 3. The probability

The outcome is a two-horse race between the leader and the runner-up, and it is
not decided on election night: special votes are counted over the fortnight
after it and have changed seats every cycle. So `p(win)` is the chance this
candidate wins the **seat** — after the ordinary count _and_ the specials — and
the special vote enters as one more term in the same distribution.

```
mean     = margin + remaining × (expected_share_leader − expected_share_runnerup)
sd       = sqrt( (Δshare × size_sd)²                 // how much is out
               + (remaining × sampling_sd)²          // how much its composition could vary
               + (remaining × τ)²                    // genuine seat-level deviation
               + (specials × SPECIALS_SWING_SD)² )   // the special vote, still to come
p(win)   = Φ(mean / sd)
```

The specials term is the same margin being moved by a second, later process: the
seat's own measured special volume times the prior spread on how far the specials'
split strays from the count's (§4). It is added as variance rather than modelled
as a separate event because it acts on the same quantity — the margin between
these two candidates.

Two consequences worth knowing:

- **It is continuous through completion.** As tonight's votes run out, `remaining`
  and its uncertainty go to zero and `p(win)` converges on the specials
  probability, so the number does not jump when the count is declared complete.
- **It is always at or below the count-only probability**, and `countProbability`
  still reports that older quantity for anything making a claim about the count
  rather than the seat.

- `size_sd = remaining × REMAINING_SIZE_SD` (0.12): the remaining vote could be
  materially more or less than the turnout estimate. This is the term that keeps
  the model honest early, when `remaining` is largest and least certain.
- `specials × SPECIALS_SWING_SD` never shrinks during the night: it is the risk
  that arrives after the count, and it is why a seat with 12,000 specials to come
  is never called as confidently as one with 4,000.
- `sampling_sd` is the multinomial standard error of the difference in shares,
  `sqrt(s₁(1−s₁)/n + s₂(1−s₂)/n)`. It shrinks as votes arrive, but it is
  **within** the remaining vote, not a margin of error on the count.
- `remaining × τ` is the possibility that the missing votes are not like the
  counted ones — the real reason a 60% count is not decisive.

The reported percentage is `Φ(mean/sd)`, rounded to a whole number on the page —
including 100%, when that is what the arithmetic gives. There is deliberately no
ceiling short of it: a number held at 99% when the distribution says 99.99% is a
cap the reader cannot see, and it moves for no reason the reader can observe.

What keeps a live count humble is the _width_ of the distribution, not a clamp.
At 20% counted the spread is far too wide for any margin to reach 100%; by the
end of the night only a seat that is genuinely all but decided gets there, and
one that is not keeps a number that says so. The odd-looking case — a 2,800-vote
margin from 3,000 counted reading 100% — is the model being honest about what the
count has actually shown, not a rounding fault.

The one piece of clawback left is `PROVISIONAL_CEILING` (95%, floored at 5%): a
seat whose prior is only party-level, with no candidate from the previous result
standing again, is describing an apportionment rather than its own history, and
the model will not call a seat on the strength of it. That is a statement about
the evidence behind the prior, not about rounding.

`computeSeatChance` also returns two plainly-stated bounds:

- `insideOutstanding = margin < remaining + 1.5 × size_sd` — the margin is inside
  the votes still to be counted, so the seat can still change tonight.
- `specialsRequiredSwing = margin ÷ specialsOutstanding` — how far the special
  vote's split would have to run against the leader, in share points, for the seat
  to change. Pure arithmetic, no free parameters (see §4).
- `specialsProbability = Φ(specialsRequiredSwing ÷ SPECIALS_SWING_SD)` — the
  chance this margin survives the special vote, from the prior spread below. It
  is the same quantity `p(win)` converges on as the count fills, and on a finished
  count it _is_ `p(win)`.
- `insideSpecials = specialsProbability < 0.95` — worth a line on the card, where
  the arithmetic is otherwise left to the reader. Carried in both states, and the
  card and the feed both read it rather than recomputing it.

## 4. The special vote

A night's count is not a result: the specials are counted over the fortnight
after it, and in 2023 they were 21.0% of all votes and did change seats (Nelson
by 29 votes, Tāmaki Makaurau by 4). The model states the volume, because it is
the only thing the panel can honestly say once the ordinary count stops.

```
specials = enrolment × turnout × specialShare × specialRatio
```

`specialShare` is the cycle's national figure (17.2% → 17.4% → 21.0% for 2017,
2020, 2023). `specialRatio` is the seat's own history — its share of specials in
the baseline's source cycle, divided by that cycle's national share — and it is
carried in the baseline (`specialRatioForSeat`), null where the seat's prior had
to be built from place geometry.

**Why not the flat national share.** Specials are not spread evenly, and the
difference is far too big to ignore. Measured from the Commission's own
`party-sdv-by-electorate` tables against the archive's seat totals:

| 2023, share of a seat's votes |                                            |
| ----------------------------- | ------------------------------------------ |
| National                      | 21.0%                                      |
| General seats — minimum       | 12.7% Invercargill                         |
| General seats — median        | 19.1%                                      |
| General seats — maximum       | 34.8% Auckland Central                     |
| Māori seats — median          | 28.6% (all seven above the national share) |

A flat share was wrong by a median 1,815 votes per seat and up to 4,879
(Auckland Central: 7,468 predicted against 12,347 counted) — larger than most
of the margins `insideSpecials` is compared against.

**Why a ratio and not a share.** The geography is stable and the level is not:
correlating each seat's 2020 share with its 2023 share across all 72 seats gives
**r = 0.96**, with the same seats at each end (Manurewa 28.3% → 34.5%, Auckland
Central 27.8% → 34.8%, Invercargill 11.3% → 12.7%). The national share moves
with enrolment rules and advance-voting behaviour, so the baseline keeps the
part that repeats and the cycle constant keeps the part that doesn't.

Data: `packages/core/data/special-votes-by-electorate.json`, generated by
`scripts/build-special-vote-shares.mjs` from the Commission's per-electorate
table (read through the Wayback Machine — the live hosts refuse
`/statistics/*.html`) and the archive's own seat totals. Both cycles reconcile to
the published national totals: 602,488 against 603,257 for 2023, and 504,621
against 504,625 for 2020.

**How the adjustment works.** Specials change nothing by arriving — they change
a seat by _differing_ from the count. If the leader takes share `x` of them and
the runner-up `y`, the margin becomes `margin + specials × (x − y)`, so it is
erased when the specials favour the challenger by more than `margin ÷ specials`:

```
required = margin ÷ specials               e.g. 396 ÷ 9,700 = 4.1 points
P(lead holds) = Φ(required ÷ SPECIALS_SWING_SD)     = Φ(0.41) = 66%
```

The first line is arithmetic, and it is the number worth showing: _the specials
would have to split 4.1 points harder against the leader than the count did._
The second line needs a distribution for that swing, and it is a **zero-mean
normal with a 10-point standard deviation** — a prior, not a measurement. Zero
mean is deliberate and is the model's biggest known bias: the specials' lean is a
cycle-by-cycle political fact (they ran left in 2017, 2020 and 2023) that this
model does not encode, so it prices _how large_ a swing is rather than predicting
its direction. A reader should treat the number as "chance the lead survives",
not "chance this party wins".

`SPECIALS_SWING_SD = 0.10` is stated as a prior for a reason: 2023's flips
(Nelson 29 votes, Te Atatū 131, Tāmaki Makaurau 4) require a two-candidate
differential of roughly 5–15 points between the specials and the count, so ±20
points at 2σ contains them while keeping a 5,000-vote margin out of coin-toss
territory. It is one number in one place so the validation harness can calibrate
it against the seats that actually moved — the arrangement `tau` already has.

The differential itself cannot be measured from the archives: the Commission
publishes the special vote's _volume_ per electorate and never its party split
(`statistics.xml` has no special-vote row, and the special-declaration tables are
volumes only). When that data is obtainable, the honest upgrade is a measured,
seat-level mean rather than a zero — which would turn this into a directional
claim the model could actually stand behind.

## Constants

| Constant                    | Value | Where it comes from                                            |
| --------------------------- | ----- | -------------------------------------------------------------- |
| `CYCLE_CONSTANTS`           | table | per cycle, below                                               |
| `LATEST_CYCLE`              | 2026  | newest cycle in the table (2026 is `assumed`)                  |
| `DEFAULT_TAU`               | 0.03  | fallback only; the real value is measured per transition       |
| `REMAINING_SIZE_SD`         | 0.12  | tolerance on the turnout estimate                              |
| `COMPLETE_THRESHOLD`        | 0.99  | progress that counts as finished, when there is no place count |
| `SPECIALS_SWING_SD`         | 0.10  | prior; sd of the special vote's two-candidate swing            |
| `SPECIALS_NOTICE_THRESHOLD` | 0.95  | survival chance below which the card mentions specials         |
| `PLACES_COMPLETE_THRESHOLD` | 1     | share of a seat's places that must report to finish it         |

| Cycle | `turnout` | `nightShare` | `specialShare` |
| ----- | --------- | ------------ | -------------- |
| 2017  | 0.789     | 0.838        | 0.172          |
| 2020  | 0.819     | 0.821        | 0.174          |
| 2023  | 0.777     | 0.783        | 0.210          |
| 2026  | 0.795     | 0.780        | 0.210          |

An unseen cycle inherits the newest row and is flagged `assumed`, which also
multiplies `REMAINING_SIZE_SD` by 1.6.

## States

The page shows three things, never a fourth:

- `waiting` — no votes, no turnout, or fewer than two candidates. The page shows
  when results are expected, not a number. A number with nothing behind it is
  worse than no number.
- `counting` — a probability, with the margin and the outstanding vote stated
  beside it.
- `complete` — every one of the seat's places has reported, or — where the feed
  publishes no place count — progress is at or above `COMPLETE_THRESHOLD`. It
  still carries `specialsOutstanding` and `insideSpecials`, because a finished
  count is not a result. The
  probability disappears and is replaced by the margin as a fact. A count that
  is finished does not have a chance of changing; printing 100% would claim more
  than we know and teach the reader that the number is decorative.

  Other surfaces keep the same number in this state rather than a word: the
  Seats page's Certainty column, Close Calls and Flipped all print `p(win)` for a
  complete count, because the count stopping is not the seat deciding and a seat
  at 55% must not read as settled — or sort as settled, which is why a finished
  seat's Close Calls rank is its chance and not "done".

  The bar is all of them, not most of them. It was 0.98 once, so that the last
  slow booth would not hold a whole seat in `counting`; a straggler is the
  better error, because `counting` keeps printing how much is still out and a
  finished seat can be waited out. Both archived cycles say the bar is
  attainable: every one of the 72 seat files in 2020 and 2023 reads
  `100.0`.

  The residual risk is the other direction, and it is not modelled away: 100% of
  _entries_ is not 100% of _votes_, and a seat's entries are mostly tiny advance
  slices. If the last entries to arrive were a seat's largest booths — the
  adversarial case, not the usual one — a count could be declared finished with
  a few percent of its vote still arriving. `complete` states that in place of
  the probability by printing the special votes still to be added, which are 21%
  of a cycle's votes and swamp that residual.

## What the model cannot know

- **Which places are missing.** v1 knows how many votes are out, not where they
  are. A seat whose remaining votes are all in one advance hub is more predictable
  than one spread across 40 booths; the per-place layer would say which, and this
  version does not read it.
- **Whether an early sample is representative.** Advance votes are counted from
  9am and released in a block after 7pm. They skew to parties with organised
  early turnout, so the first hour of counting is not a random sample of the
  seat. The swing is measured from the night's own seats, which limits the damage
  but does not remove it.
- **Turnout.** The cycle's turnout is one national figure. A seat whose voters
  turn out unusually will differ, and the error goes straight into `remaining`.
  The 2026 cycle's figures are not published yet, so they are inherited from 2023
  and flagged `assumed` — a new candidate cannot be assumed to turn out like the
  last one.
- **Specials.** Not in the number at all; `insideSpecials` is a separate flag.
- **Seats with no baseline.** A genuinely new seat — and, in 2026, the 10 that
  are new or renamed — has no same-name predecessor, so its prior is apportioned
  from the places inside the new boundary. That subset omits advance votes cast
  for the seat from elsewhere, so those priors are marked
  `method: 'place-apportioned'` and are less trustworthy than one taken from a
  seat's own result. A seat with no prior at all says so (`provisionalPrior`).

## Validation

Held back from the 2023 archive: replay the night's counts in order, and score
the model at every point where it would have shown a number.

- **Brier score** against the actual winner, versus the naive baseline "whoever
  is leading now wins". The model has to beat the naive rule to be worth its
  complexity; that is the only bar that matters.
- **Flips caught**: seats that changed hands during the night, and how early the
  model gave the eventual winner a real chance.
- **False confidence**: the worst case is a number above 90% for a seat that
  changed hands. Any such seat is a bug, and the model's `sd` is too small.

The harness is `scripts/validate-seat-probability.mjs`. It replays each 2023
seat from the archived per-voting-place results, releasing votes cast away from
home first (those are advance votes by construction — nobody can vote at another
electorate's booth on election day) and then the seat's own places. It
recomputes the national swing at every checkpoint across the seats, the way the
live pipeline does, and scores 374 checkpoints from 27 seats. It reads the
archive cache that `scripts/build-notional-baseline.mjs` writes
(`.cache/notional-<year>-files-v2.json`, override with `--cache=<path>`), so the
seat count is whatever that run fetched — the table below used a 27-seat cache.

| composition             | Brier      | early  | late       | mean p on flips | ≥95% calls | of those wrong |
| ----------------------- | ---------- | ------ | ---------- | --------------- | ---------- | -------------- |
| 0 (sampling only)       | 0.0331     | 0.0294 | 0.0363     | 0.610           | 282        | 0              |
| 0.5                     | 0.0277     | 0.0224 | 0.0323     | 0.551           | 281        | 0              |
| **1 (default)**         | **0.0260** | 0.0282 | **0.0240** | **0.429**       | 279        | 0              |
| 1.5                     | 0.0290     | 0.0413 | 0.0183     | 0.317           | 275        | 0              |
| 2                       | 0.0362     | 0.0592 | 0.0162     | 0.233           | 268        | 0              |
| naive "leader now wins" | 0.0561     | 0.0402 | 0.0700     | —               | 374        | 21             |

What it says. The composition term pays: sampling-only is 27% worse on Brier
and gives the eventual loser 61% on average at the checkpoints that flipped,
against 43% with the term. The default of `1` — the value the 2023/2020
advance-vote measurement implied — is also the minimum of the sweep, which is
suggestive rather than proof: 21 of the 374 checkpoints flipped, they come from
about seven seats, and checkpoints inside one seat are heavily correlated. The
expected loser never received 95% or more under any strength, so the sweep
cannot separate the strengths on false confidence; it separates them on being
over-confident about real flips.

The harness cannot see votes cast in a seat's _own_ advance centres: the
archive does not distinguish them from booths. Those carry most of the advance
vote, so the replay's first hours are less advance-heavy than the real night,
and the measured benefit of the composition term is if anything an
underestimate.

## Tuning

`tau` and `REMAINING_SIZE_SD` are the two knobs. Both widen the distribution —
raising either makes the number more conservative everywhere. The measured `tau`
should be preferred to any hand-tuned value, and the validation is the arbiter:
if the model is systematically overconfident, the cause is almost always `sd`,
not `mean`.
