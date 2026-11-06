# Proposals

Hand-built mockups, not captures. The parent folder holds captures of the
running application (see [`../README.md`](../README.md)); these are static HTML
drawn ahead of implementation, so review them as a proposal. The tokens,
utilities and component classes are the real ones; the markup is not the
component.

## `candidates-chance-mobile` (folder + `.png` at this level)

On a phone the Candidates page drops the Win chance column
(`hidden sm:table-cell`), so the chance and the distance from the party's cut —
the two things the Seat cell's `List` chip is pointing at — are invisible below
640px. The folder holds seven 390px frames and `sheet.html`, the review sheet
that carries them at their true size with the trade per variant:

- **Today** — Candidate (194px) and Seat (162px), 67px rows. Nothing in a row
  says a number exists.
- **A · Let the table scroll** — the column returns; the table is 500px in a
  356px frame, so 144px sits past the right edge. Cue: a `Swipe for Win chance →`
  kicker and a right-edge fade.
- **B · Scroll, with the name pinned** — A plus `sticky left-0` on the candidate
  column. At full scroll the name is still there, the seat column leaves a 21px
  tail beside it and the chance cell fills the remaining 136px, so nothing is
  cut off or empty; the cost is the seat name, 144px of scroll and a gesture to
  learn. **Chosen.**
- **C · Two columns, routes under the name** — the Seat column goes, its routes
  fold into the candidate cell, Win chance keeps its column, header and right
  edge. 230/126, 72px rows.
- **D · One column** — the chance takes the right end of the name line and the
  cut joins the route line. 68px rows, but the numbers lose their header and,
  with the cut moved into the route line, D breaks `AGENTS.md`'s rule that the
  distance is never folded into the Seat column.

**Decided: B, the pinned name.** The reader who swipes right keeps the name
beside the number, which is the whole point of the column, and the numbers stay
in the two lines the desktop table draws. Two things changed on review when it
was built: the `Swipe for Win chance →` line above the table was dropped (the
cut column under the edge fade is the cue), and seat names are kept on one line
below `sm` as the candidate's name is, so the table grows rather than wrapping
them. See #126. C and D are kept as the alternatives
considered; C shows the chance with no gesture but gives up the seat column's
own place in the row.

```bash
# tailwindcss over "../../docs/mockups/proposals/candidates-chance-mobile/*.html",
# inline into every frame and sheet.html, then Playwright chromium at 390px / 2x
# per frame and 1400px / 2x for the sheet.
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
