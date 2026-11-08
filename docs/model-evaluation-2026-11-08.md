# Seat-probability evaluation, 2026-11-08

The offline report for the versioned probability model. It is deterministic:
the replay order, checkpoints and strengths are fixed, and the report is written
with a version and the model inputs it used.

## Produce it

```bash
npm run build:core
node scripts/validate-seat-probability.mjs --year 2023 --json \
  --out .cache/seat-probability-report-2023.json
```

The script needs the archive cache written by
`scripts/build-notional-baseline.mjs`
(`.cache/notional-<year>-files-v2.json`) and the matching baseline JSON. A run
without that cache exits with the build command in the message; the tests do not
pretend a report exists when the evidence does not.

## What it reports

- Brier score, overall and split into early/late checkpoints, plus the naive
  baseline and the mean probability on checkpoints that flipped.
- Log loss on the same pairs.
- Ten calibration bins: count, mean predicted probability and observed win
  rate, so a reader can see whether 70% seats actually win about 70% of the
  time.
- ≥95% calls and how many were wrong.
- For every strength of the composition term, so the report compares the model
  to simpler baselines rather than only to itself.

The report includes `version`, `generatedAt`, `year`, `checkpoints`,
`strengths`, the cycle constants and `limits`.

## Limits (stated in the report itself)

- Arrival order is approximated. Away-from-home votes are released first, then
  a deterministic pseudo-random order for a seat's own places. Advance votes
  cast inside a seat cannot be separated from booths.
- Checkpoints within a seat are correlated; the effective sample is the seat
  count, not the checkpoint count.
- 2023 is the archive used here. This is not a final-result or special-vote
  calibration.
- The specials evidence in `docs/seat-probability-model.md` §4 is marked
  **unverified, pending regeneration** after the specials parser repair.
  `SPECIALS_SWING_SD` is **not** tuned from this report.
- No parameter change is proposed. Any change must be recorded separately for
  approval, with the evaluation that supports it.

## Final and unknown phases

`packages/core/src/count-summary.ts` separates the count's phase from any
probability. An official result (`finalSemantics: 'validated'` and `final:
true`) reports no outstanding ordinary or special votes; an unknown phase is
not treated as final. A forecast is never printed as a counted fact: the band's
ordinary and specials figures are separately labelled estimates, and the
chance remains in the table's Win % column.
