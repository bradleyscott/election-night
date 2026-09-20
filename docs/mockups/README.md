# Design captures

These are not hand-drawn mockups. Each pair is a capture of the **running
application** — the real components, the real stylesheet, real results — so what
is reviewed here is what ships.

## How they were produced

```bash
# 1. Build the shared package and the dashboard bundle
npm run build:core && npm run build -w packages/dashboard

# 2. Live cycle from the Commission's 2023 archive (the 2026 feed is not
#    published yet), which makes 2020 and 2017 the prior cycles.
ELECTION_YEAR=2023 npm run start:collector
(cd packages/dashboard && npm start)

# 3. Drive headless Chrome over CDP: navigate, wait for the rendered marker,
#    then save document.documentElement.outerHTML and Page.captureScreenshot.
```

The HTML files have the built stylesheet inlined so they open standalone; the
Google Fonts `<link>` is left intact. The PNGs are the same render at viewport
scale.

## What each shows

### `flipped-page` (`.html` / `.png`)

`/flipped` against the live cycle. 25 of 65 comparable general seats had changed
hands by the time of the capture, ordered by the current leader's share of the
vote. Note the **2020 margin** column — the previous holder's majority of
victory, labelled as such — beside tonight's lead: both percentages say what
they are a share of (`of votes cast` for the completed cycle, `of counted` for
tonight). The only year references are the ones that carry information (the
page kicker and the two comparison column headers); everything else is
relative, so a different prior cycle reads correctly.

Every margin of error reads `±0.0%` because the 2023 archive is a *final*
result (100% of places counted), not a partial count; the same page on election
night shows the real polling band. The same reason makes every row "Likely
winner" rather than the "Too close to call" a partial count produces.

### `electorate-past-winners` (`.html` / `.png`)

An electorate page (`Banks Peninsula`) with the **Past winners** panel below the
results table. Two cycles resolved: 2020 (McLellan, Labour, majority 13,156) and
2017 (Dyson, Labour, majority 7,916), each labelled `Majority` with its share of
votes cast beneath. Both carry a FLIPPED chip because National leads the seat
now, and the 2017 row is labelled `as Port Hills` — the seat that name's area
became — so the comparison is auditable rather than taken on trust.

Seats with no comparable prior holder (created by a merge or split, or new)
replace the table with a one-line explanation. See
[`../prior-election-results.md`](../prior-election-results.md).
