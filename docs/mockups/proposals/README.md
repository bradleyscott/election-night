# Proposals

Hand-built mockups, not captures. The parent folder holds captures of the
running application (see [`../README.md`](../README.md)); these are static HTML
drawn ahead of implementation, so review them as a proposal. The tokens,
utilities and component classes are the real ones; the markup is not the
component.

## `a-semicircle` / `b-stadium` — the seat grid as a chamber

Both files are the **running** `/seats` page, captured against the 2026 mock
feed at 87.4% counted (123 seats, six parties), with only the seat block
replaced: `seats-hemicycle.before.html` is that capture, and `build.py` takes
the 123 rendered seats — party, colour and fill opacity — and re-lays them on an
arc. The masthead, stat strip, party table, coalition footer and "Show all
parties" chip are the captured page.

The reorder is live in both files, not drawn: drag a seat onto another party's
seat and the parties swap, the table re-sorts and the coalition footer
recomputes from the new seating order (`verify.mjs` drives that through the DOM).
Reset restores the captured order. The seat grid was always pointer-only
(`draggable`, no touch sensor) and stays that way; the table rows keep dnd-kit.

- **A — hemisphere.** 180°, one radius from the floor: 744 × 410 in the panel,
  seat 17.0px.
- **B — chamber.** Straight benches either side of the Table and a round end,
  which is the debating chamber: dome radius 352, 148px of straight arm each
  side, 704 × 540, seat 19.8px. The Speaker sits in the gap between the arms.
  (A 215° horseshoe with curved arms was drawn first and dropped: its arms are
  neither a hemisphere nor the chamber's straight benches.)

The seat order now lands on the chamber's own sides. Index 0 is the bottom of
the left arm and the last seat is the bottom of the right arm, so with the
default order the largest party sits on the Speaker's right and the second
largest opposite — the Government and Opposition benches, without any code
knowing about either.

The majority marker is a brand spoke at the apex rather than a line across the
grid. It sits half a column right of centre, in the gap between the two middle
columns: the grid's line bisects the middle column and paints over a seat. It
runs through the three rings and 26px past the inner one — 87px in total, against
the grid's full height, which is the open question for review.

At 390px B fits the 324px panel with no horizontal scroll, 262px tall, 9.0px
seats; A is 194px tall with 7.3px seats. The shipped grid is `min-w-[480px]` and
scrolls sideways there.

The seat mark is the open choice, drawn side by side in `seat-mark-sheet.png`:
the square the grid uses today, rotated along the path, or the parliament-chart
dot. The mark sheet's crops come from `b-stadium.html` and `d-stadium-dots.html`,
which differ only in that flag.

Shape is one function. The chamber is a path — left arm, semicircular end, right
arm — and a seat is a point on it: column *c* at `c * spacing` of arc length, ring
*r* offset `r * gap` along the inward normal. `armFrac` 0 collapses the straight
arms into A's hemisphere; `maxR` sets how wide the dome is. Nothing outside the
geometry changes: the same elements carry the drag, hover, select and keyboard
handlers, and the keyboard mapping still holds because seat index is still
`column * 3 + ring` (±1 moves a bench, ±3 moves along it).

The right-hand Live Feed column is empty in these captures because the mock feed
stayed on one stage, so nothing was diffed into feed events.

```bash
cd docs/mockups/proposals
python3 build.py     # seats-hemicycle.before.html -> a/b/d .html
node render.mjs      # desktop, phone (390 @2x), shape and seat-mark sheets
node verify.mjs      # reorder, table sync, coalition maths, overflow
```

## `win-percent-header-mobile` (`.html` / `.png`)

The **Win %** header after the two-line version proved too wide on a phone: at
390px the second line, `ⓘ How it works`, was 83px against a 45px label, so the
sentence set the column (103px in the running app) and the header stood 43px
tall. The page holds four compact forms of the same header, each in the seat
panel's results table at 390px, with the desktop behaviour stated per variant:

- **1 · Short line** — `Info` below the label on phones; the column falls back
  to the label's width (78px in the drawing) and the line stays.
- **2 · Box mark** — the 18px boxed `i` on the label's line; one line, but the
  words go.
- **3 · Inline info** — `Win % info` on one line; a word, but barely narrower
  than the box.
- **4 · Dotted label** — the label wears a 2px dotted rule in its own ink; one
  line at every width, with no separate mark.

**Decided: 4, the dotted rule.** A dotted rule is the printed mark for a term
with more behind it, so it reads as a definition rather than a link, and it
keeps the header to one line. With the mark gone it gives back 31px, level with
option 1 in the drawing, and it has no word on the phone; that is the accepted
trade. Shipped in `packages/dashboard/src/components/WinPercentLink.tsx`: the
label is a span with `underline decoration-current decoration-dotted
decoration-2 underline-offset-4`, so the 2px rule is in the label's ink and the
existing hover colour change carries it. There is no icon; the accessible name,
the whole-cell hit area and the drawer are unchanged.
`WinPercentDrawer.test.tsx` pins the dotted rule, the weight, the label text and
that the header is not a flex column.

**Measurements.** The running app went from a 103px column and 43px row to
68px and 36px at 390px. The hand-drawn tables here render C at 109px and the
dotted variant at 78px; the difference from the app is the table's auto layout
distributing more slack in a two-row table, so compare the deltas. The content
widths are the same (45px label, 83px subline for C); the dotted variant's
content is the label alone. The vote figures are the same illustrative Banks
Peninsula moment as the earlier header work: 68% counted, 8,412 to 8,019, 54
and 45.

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/winpct-mobile.css \
  --content "../../docs/mockups/proposals/win-percent-header-mobile.html"

# inline /tmp/winpct-mobile.css into the <style> block (replace the existing
# block; the file is already inlined), then capture 1400×2380 at 2x. The height
# is document.documentElement.scrollHeight; re-measure after copy changes.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1400,2380 --virtual-time-budget=12000 \
  --screenshot=win-percent-header-mobile.png \
  "file://$PWD/../../docs/mockups/proposals/win-percent-header-mobile.html"
```
