# Win chance on a phone

The Candidates page drops the Win chance column below `sm`
(`hidden sm:table-cell` in `packages/dashboard/src/pages/Candidates.tsx`), so a
phone shows the candidate's name and routes and nothing else. The chance and the
distance from the party's cut, the two things the Seat cell's `List` chip is
pointing at, are both invisible below 640px.

`sheet.html` / `../candidates-chance-mobile.png` is the review sheet: it carries
the seven 390px frames below at their true size, with the trade per variant.

| frame | what it is |
| --- | --- |
| `today` | the page as it ships, for reference |
| `scroll-rest` `scroll-end` | **A** — the column returns and the table scrolls; the cue is a `Swipe for Win chance →` kicker and a right-edge fade |
| `pin-rest` `pin-end` | **B** — A with `sticky left-0` on the candidate column, so the name survives the scroll |
| `two-col` | **C** — the Seat column goes, its routes fold under the name, Win chance keeps its column, header and right edge |
| `one-col` | **D** — one cell: the chance takes the right end of the name line, the cut joins the route line |

**Recommended: C.** It is the only one that shows the chance without a gesture,
keeps the numbers in a column under their own header, and it is the shape the
seat panel already uses on a phone, where the party folds under the candidate's
name so that `Win %` can stay in its column
(`packages/dashboard/src/components/ElectorateResultsTable.tsx`). It also leaves
`AGENTS.md`'s rule intact — the distance from the cut is never folded into the
Seat column; C moves the routes, not the distance. D breaks that rule.

**Measurements at 390px** (frame 356px wide, from the captures): today's two
columns render 194 and 162 with 67px rows. A's table is 500px, so 144px sits
past the right edge; its columns are 199/165/136. B pins 199 of the 356 and
leaves ~90px empty between the name and the number at full scroll. C is 230/126
with 72px rows; D is one 356px column with 68px rows. Page heights for the seven
rows: 598 (today), 649 (A and B), 668 (C), 653 (D).

The names and figures are illustrative, built to cover the four row shapes the
table can take: seat + list, list only, seat only (the model prices nobody, so
`0%` in red) and one exactly on the cut. Tokens, utilities and component classes
are the real ones; the markup is not the component, and desktop is untouched in
every variant.

## Regenerating

Each frame is a standalone page with the app's compiled stylesheet inlined.

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/cand.css \
  --content "../../docs/mockups/proposals/candidates-chance-mobile/*.html"
# then replace the `/*INLINE*/` placeholder in every frame and in sheet.html
# with /tmp/cand.css
```

Frames are captured at **390px wide, device scale 2** (Playwright chromium,
`fullPage`), and the sheet at **1400px, scale 2** with the frames placed at their
natural 390px so the phone type is not resampled. Re-capture the frames before
the sheet whenever a frame changes, and re-measure `document.body.scrollHeight`
after any copy edit.
