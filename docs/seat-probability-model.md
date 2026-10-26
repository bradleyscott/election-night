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
enrolment        = recorded, else total_votes_cast / percent_votes_cast
expected_night   = enrolment × turnout × nightShare      (cycle's own figures)
remaining        = max(0, expected_night − total_votes_cast)
progress         = total_votes_cast / expected_night
```

`turnout` and `nightShare` are **per cycle**, not one number for all of them:
turnout was 78.9% in 2017, 81.9% in 2020 and 77.7% in 2023, and the night's share
of the final count was 0.838, 0.821 and 0.783. A cycle with no published figures
yet (2026 today) inherits the newest one and is marked `assumed`: specials have
risen every cycle, so carrying them forward overstates the night's total, which
makes the model think more is still out and close seats late rather than early.
That assumption also scales the size uncertainty by 1.6.

`percent_voting_places_counted` is **not** used anywhere. It counts voting
places, not votes: places are not equal in size, and a seat's advance votes
arrive in block transfers that have nothing to do with how many booths have
reported. A seat can be 100% of places counted and still have 20% of its votes
out.

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
  party, so `partyCandidateShare` — the party's share of the *candidate* vote —
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

The outcome is a two-horse race between the leader and the runner-up on tonight's
count, so the question is whether the outstanding votes can erase `margin`.

```
mean     = margin + remaining × (expected_share_leader − expected_share_runnerup)
sd       = sqrt( (Δshare × size_sd)²                 // how much is out
               + (remaining × sampling_sd)²          // how much its composition could vary
               + (remaining × τ)² )                  // genuine seat-level deviation
p(win)   = Φ(mean / sd)
```

- `size_sd = remaining × REMAINING_SIZE_SD` (0.12): the remaining vote could be
  materially more or less than the turnout estimate. This is the term that keeps
  the model honest early, when `remaining` is largest and least certain.
- `sampling_sd` is the multinomial standard error of the difference in shares,
  `sqrt(s₁(1−s₁)/n + s₂(1−s₂)/n)`. It shrinks as votes arrive, but it is
  **within** the remaining vote, not a margin of error on the count.
- `remaining × τ` is the possibility that the missing votes are not like the
  counted ones — the real reason a 60% count is not decisive.

The reported percentage is `Φ(mean/sd)`, clamped to the interval
`[CERTAINTY_FLOOR, CERTAINTY_CEILING]` (1%–99%) and rounded to a whole number on
the page. The clamp is deliberate: a normal tail reaches 99.99% and would round
to 100%, which reads as a call the count has not made — and a seat reported at
100% that later changes hands discredits every other number beside it.

`computeSeatChance` also returns two plainly-stated bounds:

- `insideOutstanding = margin < remaining + 1.5 × size_sd` — the margin is inside
  the votes still to be counted, so the seat can still change tonight.
- `insideSpecials = margin < specialsOutstanding × 0.2` — the margin is small
  enough that the special-vote differential could still change it after the
  night. A fifth of the special vote is the differential that has actually
  decided seats historically.

## Constants

| Constant               | Value | Where it comes from                                        |
| ---------------------- | ----- | ---------------------------------------------------------- |
| `CYCLE_CONSTANTS`      | table | per cycle, below                                           |
| `LATEST_CYCLE`         | 2023  | newest cycle with published figures                        |
| `DEFAULT_TAU`          | 0.03  | fallback only; the real value is measured per transition   |
| `REMAINING_SIZE_SD`    | 0.12  | tolerance on the turnout estimate                          |
| `COMPLETE_THRESHOLD`   | 0.99  | progress at which the count is treated as finished         |

| Cycle | `turnout` | `nightShare` | `specialShare` |
| ----- | --------- | ------------ | -------------- |
| 2017  | 0.789     | 0.838        | 0.172          |
| 2020  | 0.819     | 0.821        | 0.174          |
| 2023  | 0.777     | 0.783        | 0.210          |

An unseen cycle inherits the 2023 row and is flagged `assumed`, which also
multiplies `REMAINING_SIZE_SD` by 1.6.

## States

The page shows three things, never a fourth:

- `waiting` — no votes, no turnout, or fewer than two candidates. The page shows
  when results are expected, not a number. A number with nothing behind it is
  worse than no number.
- `counting` — a probability, with the margin and the outstanding vote stated
  beside it.
- `complete` — progress at or above the threshold. The probability disappears
  and is replaced by the margin as a fact. A count that is finished does not have
  a chance of changing; printing 100% would claim more than we know and teach the
  reader that the number is decorative.

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
live pipeline does, and scores 374 checkpoints from 27 seats.

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
