# Proposals

Hand-built mockups, not captures. The parent folder holds captures of the
running application (see [`../README.md`](../README.md)); these are static HTML
drawn ahead of implementation, so review them as a proposal — the tokens,
utilities and component classes are the real ones, the markup is not the
component.

## `counted-tape` (`.html` / `.png`)

The two **Counted** charts — the electorate panel's `VoteHistoryChart` and the
Trends page — redrawn in the vocabulary of the **night tape** from
`voting-places-map.html`: the Counted series in its own green, drawn as a step,
with mono numerals, hairline rules and dashed gridlines. Each surface gets the
element only it can have: the seat has per-voting-place receipt times, so its
tape carries a rug of them; the country has only snapshots, so its tape steps
between scrapes. Both stop at the last scrape rather than running to midnight —
a count is a record, not a forecast — and nothing marks "now", because the step
already begins at the most recent observation.

**Shipped.** `packages/dashboard/src/components/CountedTape.tsx` draws it; both
charts swap their monotone green line for it when their mode is Counted, and the
axis vocabulary (mono ticks, `1.4M` / `47%` rounding, dashed grid, tooltip
chrome) lives in `packages/dashboard/src/lib/chart-format.ts` so the three modes
of each chart read alike.

Numbers are a synthetic night rather than any real cycle — advance votes land
just after seven and the count climbs through the evening — and the seat label
(Epsom) is illustrative. Regenerate the capture as
described for `electorate-pwin` below, at 1400 px wide.

## `electorate-pwin` (`.html` / `.png`)

The electorate detail panel with the margin-of-error strip replaced by a single
chance-of-winning number, shown in its three states: before counting, counting,
and the night's count complete.

**Decided:** **A, E and C are locked** — the same panel in its three states
(before counting, counting, count complete). Everything else in the file is a
rejected alternative and can be deleted:

- **B, D, F** — superseded by E. Their count figures (`68% in`, `≈46,450`) are
  the older, incoherent ones and are not what shipped.
- **E · party mode** is part of the lock: the verdict is *removed*, not
  relabelled — no margin, no status, no chance of winning, because those are
  candidate facts. The count chip stays in the same top-right slot in both
  modes, because it describes the count, not the vote.

**The count chip never states a total.** A seat's eventual total is not in the
feed: `votePercentageCounted` is `percent_voting_places_counted`
(`packages/core/src/sources/nz-election-xml.ts:340`), and
`ElectorateStats.tsx:58-66` divides votes by it to print "of N total" as if
measured. Because advance votes are counted from 9am and land in large blocks
first, that division understates the final total early in the night. Show votes
counted and a percentage, both from votes, and put any estimated total behind a
disclosure.

Regenerate the stylesheet and the capture:

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/pwin.css \
  --content "../../docs/mockups/proposals/electorate-pwin.html"

# inline /tmp/pwin.css into the <style> block, then capture 760×3465 at 2x
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=760,3465 --virtual-time-budget=12000 \
  --screenshot=electorate-pwin.png \
  "file://$PWD/../../docs/mockups/proposals/electorate-pwin.html"
```

Panel B's names and partial counts are illustrative, and the party-vote figures
in the party-mode panel are illustrative too (they sum to 31,590 so the shares
are self-consistent). Panel C is the real 2023 Banks Peninsula result (WEENINK
17,860 · McLELLAN 17,464 · margin 396), and the seat's final total of 48,891 is
the sum of its real candidate votes.

## `electorate-map-controls` (`.html` / `.png`)

Where the electorates page's three map controls — seat search, the General/Māori
switch and Clear — should live. Today they are the page header's second half, a
row that acts on a panel 30px below it; Clear only exists once a seat is open,
so the header's contents depend on the map's state. The file draws the header as
it is, then two placements that keep all three controls: **A** a floating card
in the map's top-left corner (zoom moved to the top-right, ledger keeps the
bottom-left), **B** a hairline row inside the map card above the map, and **C**
a full-width landing state where there is no Clear to show. **D** is the same
three states at 390px.

**Decided: B, everywhere** — desktop and phone, with a seat open and without
one. A costs geometry rather than header furniture: after a click the seat's
bounds fill the frame, so the card sits over whatever the fit put in that
corner, and the open search list covers more of it. B adds a 56px row to the
card (the controls are 44px hit targets plus the row's padding) and gives the
map every pixel; at `sm` and below those controls already wrapped to their own
row, so the phone gains nothing and loses nothing. C is not a third design, it
is what B looks like before a seat is picked — the same card, Clear absent.

Shipped as `packages/dashboard/src/components/MapControls.tsx`, used as the map
card's first child on `packages/dashboard/src/pages/Electorates.tsx`. The row
carries `z-[1100]`: the open search list has to clear the corners Leaflet stacks
its zoom buttons in (`z-index: 1000`), and the map's panes are at 400, so
anything lower puts the list under the geometry or under the buttons — both
observed while building it.

The map is real 2023 general-electorate geometry, projected and inlined once as
an SVG group from
`packages/dashboard/public/boundaries/2023/general-electorates.geojson`, with
the seat-open panels framed the way `fitBounds` frames Banks Peninsula and fills
taken from `mapFillOpacity`. The island group is drawn at the time of writing and
is edited by hand in the file like the rest of the markup; the numeric detail
panel is a stub (Banks Peninsula, 54 / 45).

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/map-controls.css \
  --content "../../docs/mockups/proposals/electorate-map-controls.html"

# inline /tmp/map-controls.css into the <style> block, then capture 1400×4131 at
# 2x (the page height is document.documentElement.scrollHeight; re-measure after
# editing copy, an over-tall window pads the bottom with the page background)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1400,4131 --virtual-time-budget=12000 \
  --screenshot=electorate-map-controls.png \
  "file://$PWD/../../docs/mockups/proposals/electorate-map-controls.html"
```

## `count-complete` (`.html` / `.png`)

> **Superseded** by `electorate-page` (design B): the card this file designs no
> longer exists. Kept for the record — the argument about the specials, and the
> `insideSpecials` line, moved into the count band.

The electorate panel's **count complete** card, drawn four ways plus today at
the 512px the detail column gives it on a 1400px page: **A** is the counting
card's own rows handed over unchanged, with the strip reinterpreted; **B** names
the winner and puts the margin in a sentence; **C** leads with the margin at
6xl; **D** is a returns sheet of mono facts. Every card holds Banks Peninsula at
the same moment — 13,984 against 13,674, a margin of 310, 80% of the expected
final vote in, about 9,700 special votes to come — so only the design moves.

The card's problem is not the number: once the count is complete a probability
would have to read 100%, so the card has to lead with something else. It is
that today's card stops at *Tonight's count complete* and says nothing about the
special votes, which is the one thing that can still move the seat. The page
therefore keeps a second column of real 2023 figures beside the constructions:
Banks Peninsula finished 17,860 to 17,464 — a margin of 396, 0.8% — after the
specials were added, so a card that hides them is silent through the only
fortnight in which the seat was still undecided.

**Decided: A**, because the panel needs no second vocabulary when the count
stops: the rows, the bars and the margin line are already the ones on screen all
night, and the specials arrive in the slot the outstanding votes just left. B's
closing *not final* block is worth taking for A's caption. B, C and D are
rejected alternatives and can be deleted.

**Shipped.** `ElectorateStats.tsx` draws the complete state from the same
`ChanceRow` the counting state uses, with three switches: the 4xl slot prints a
share of the votes counted to one decimal, the leader's line reads `Ahead by 310
(0.8% of votes)`, and the even tick goes — half the votes is not the line a
finished count is judged against. `SpecialsStrip` replaces `CountStrip` on the
same `SplitBar`, so the hatched end means the same thing in both states. The
field it needed is now on `SeatChance`'s complete variant: `specialsOutstanding`,
which `computeSeatChance` already computed and discarded. Vote counts reaching
the card are rounded at the display boundary (`votes()` in the component) —
enrolment × turnout × share lands on a fraction, and the card otherwise prints
*about 6,307.826 votes*; the feed commentary had the same leak and rounds too.

**Provenance.** The seat, the final margin (396) and the share of the vote that
arrives as specials (21.0% in 2023) are real. The archive publishes only final
files, so the night's own candidate votes were reconstructed by removing the
specials from the final counts in proportion: the preliminary numbers are a
construction, and the margin they produce (310) is the right order of magnitude
rather than a record.

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/complete.css \
  --content "../../docs/mockups/proposals/count-complete.html"

# inline /tmp/complete.css into the <style> block, then capture 1400×3590 at 2x
# (the height is document.documentElement.scrollHeight; re-measure after copy
# changes — an over-tall window pads the bottom with the page background)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1400,3590 --virtual-time-budget=12000 \
  --screenshot=count-complete.png \
  "file://$PWD/../../docs/mockups/proposals/count-complete.html"
```

## `electorate-page` (`.html` / `.png`)

The electorate detail column as a whole — the **Win %** card *and* the results
table under it — because the two are the problem and neither can be judged
alone. Today they print the same party, name and vote count 40px apart, sort by
different keys, carry no titles, and the table ends in a bare `%` that never
says what it is a share of. The file shows today's panel annotated, then four
designs, then all four again in the one configuration the model exists for:
**the count leader is not the likely winner**, where the current page puts the
trailing candidate at the top of the card and reverses the order in the table
directly below it.

- **A · verdict card, captioned table** — the card keeps only the chance
  (name, one number, one bar across the hundred) and everything counted moves
  into a table titled *The count so far*, with a caption stating the denominator.
  In the hard case the card gains one sentence naming who leads.
- **B · one surface** — the card is deleted; a count band sits above the table
  and the chance becomes a column, so there is nothing to duplicate and no
  second ordering to contradict.
- **C · the arithmetic card** — the card answers *what would have to happen*
  ("Weenink needs 47.9% of the votes still out"), which is (9,300 − 393) ÷
  (2 × 9,300) rather than a model output, and prints the probability as a small
  line at the foot.
- **D · two questions, one seam** — *Who wins the seat* and *Who is ahead* as
  two titled panels, with a labelled rule between them.

**Implemented: B** — one panel, one ordering, nothing printed twice. This
supersedes `electorate-pwin`, `chance-card` and `count-complete`: the "Win %"
card is gone, and `ElectorateStats.tsx` with it. A's one-sentence verdict was
the runner-up; C's arithmetic is the most interesting new fact on the page but
needs two sentences to set up and stops being informative at 92% counted; D's
seam was the clearest statement of the two questions and the most chrome.

Two amendments were made in the mockup after review:

- **`Counted` is not a column name.** B's share column is now headed **`Vote %`**
  everywhere in the file, and A and C's `Share of counted` follows it. In this
  app "counted" already means *progress* — the strip above the table reads
  `68% counted`, `vote_pct_counted` is a progress series on the Trends tape —
  so a column headed `Counted` holding `42.4%` reads as a progress figure. `Vote %`
  beside `Win %` also does the disambiguating work the bare `%` never did: the
  two percentages are obviously about different things.
- **B's phone case is fixed, not conceded.** Below `sm` the party stops being a
  column and becomes a second line under the candidate's name — the same field
  rendered twice for two layouts, the fold the Flipped page's mobile table
  already uses. Measured at 390px (356px of content, in the browser): as drawn,
  the party column takes 115px against the candidate's 88px, every name wraps,
  and the table is 28px wider than its card so Win % is clipped. Folded, the
  candidate cell gets 139px, rows go 65px → 57px, the table is 316px instead of
  334px, and overflow is zero — at 360px too. B has no card above it, so at 390px
  the whole stack is 494px against A's 543px: the fold spends none of B's height
  advantage. What is left between A and B is not a trade-off but a choice —
  whether the verdict is a card above the numbers or a column inside them.

Every height in the file is measured in the browser rather than estimated: the
closing table at the 512px column (708 / 666 / 491 / 680 / 799px) and the 390px
section at 356px of content. The markup notes carry the classes the component
would use (`hidden sm:table-cell` / `sm:hidden`, `whitespace-nowrap`,
`text-sm sm:text-base`).

**What changed on the way into the component**, none of it visible in the PNG:

- **The `Win %` track was dropped.** The mockup drew a 56px track under each
  number; rendered at 512px beside a new column it cost the candidate name enough
  width to wrap (`ANDERSON,` / `Jamie`), and at that size a bar cannot separate
  73% from 71% anyway. The number is the reading. The name cell is
  `sm:whitespace-nowrap` for the same reason, so a party name wraps before a
  candidate's does.
- **The header stays `%`, not `Vote %`.** The table already had that label and
  the instruction was to keep it. The cells now print the sign (`42.4%`), which
  is what makes a bare `%` header legible next to `Win %`.
- **The runner-up's chance is `1 − p − others`.** The card printed `1 − p`, which
  credited the runner-up with the whole field's chance in a three-way seat; the
  two printed numbers now never claim more than 100, and the caption says why
  they need not add to it.
- **The band gained a `Margin` cell**, because design B deleted the card's
  `Ahead by 393 (2.0%)` line and a table ordered by votes does not state the gap.
  It sits between `Counted` and `Still out`, which is also the clearest way to
  read why the chance is what it is: 393 against 9,300.
- **A complete count keeps a number.** The old `count-complete` card replaced the
  probability with a share of the vote on the argument that a finished count
  could only read 100%. That was true of a *count-based* probability; the number
  the model reports on completion is the chance the lead survives the special
  vote, which is 66% for Banks Peninsula and 100% only when the margin exceeds
  the whole special vote. So the column keeps it — the same number the Flipped
  and Close Calls pages keep.

**Provenance.** Banks Peninsula, the two candidates and the shape of the 2023
result are real; the partial count, the three minor candidates and both chance
figures are constructed to be self-consistent (shares sum to the counted total,
the two chances sum to 100, 47.9% is the arithmetic above).

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/electorate-page.css \
  --content "../../docs/mockups/proposals/electorate-page.html"

# inline /tmp/electorate-page.css into the <style> block, then capture 1400 wide
# page at 2x.
```

**This one needs slicing.** At 8,641 CSS px the page is 17,282 device px tall at
2x, which is past Chrome's compositor texture limit: a single window that tall
captures the *top of the page again* at the bottom of the image, with no warning
— the shot looks complete and is not. Every other shot here is under 8,200 device px
(the tallest, `electorate-map-controls`, is 8,184) and never met the limit. Capture a 1200px-tall viewport, scroll in 1200px steps,
record `window.scrollY` after each scroll (the last scroll clamps, so the
requested offset is not the real one), and stitch at those offsets into a
`height × 2` canvas. The seams fall between rows and are invisible; check one
before shipping the PNG.

The paper grain is suppressed for the same practical reason it is worth naming:
`body::after` is an SVG turbulence fill, i.e. incompressible noise over every
pixel. With it the file is 15 MB of grain that nobody can see at review scale;
without it, 3.7 MB.

## `chance-card` (`.html` / `.png`)

> **Superseded** by `electorate-page` (design B): the chance is now a column of
> the results table, not a card.

The electorate panel's **chance of winning** card, in its counting state, drawn
five ways at the 512px the detail column gives it on a 1400px page: **Today** as
it ships, then **A** one bar split 54 / 45, **B** the number with a 100-square
pictogram, **C** a position on an axis whose centre is marked *coin toss*, and
**D** today's two rows over a strip showing the count in and the votes still
out. Every card holds the same seat at the same moment (Banks Peninsula, 68%
counted, 54%, margin 393, about 9,300 still out), so only the design moves.

**Decided: D**, amended twice before shipping. The count left the header chip
and joined the strip, because *68% counted* and *9,300 still out* are the same
fact told from both ends and the strip is where the votes are; and the count
line's companion, *updated 4 min ago*, lost its box and its capitals — the
header now reads `Win %` with a plain muted *Updated 4 min ago* opposite it, so
there is no framed chip left on the card at all. A, B and C are rejected
alternatives and can be deleted.

**Shipped.** `packages/dashboard/src/components/ElectorateStats.tsx` draws the
counting state as `ChanceRow` + `CountStrip`: the row keeps its track across the
full hundred (so the fill is a share of one) and marks even with a hairline, and
the strip's hatched end is `.hatch-outstanding` in
`packages/dashboard/src/styles/index.css` — a token-level utility, because
"counted" and "still to come" must read as two states in both colour modes. The
percentage in the strip is `votesCounted / (votesCounted + remainingVotes)`, not
`percent_voting_places_counted`. `ElectorateStats.test.tsx` pins that the header
carries no chip.

The page also repeats all four on a nearly settled seat (92%, margin 4,120,
about 900 still out). A card that only works at 54 is not a card: at 92 the bar
is nearly one colour, the pictogram is nearly full and the marker sits at the
end of its scale, and each design has to stay legible without reading as a
call — which is why the printed number, not the drawing, carries the caution.

Two states are deliberately not redesigned and appear once at the foot of the
file: the settled count prints the winner, the votes and the margin as facts
(a completed count's percentage could only read 100%), and before the first
result the card says when results are expected rather than showing a number.
Party view renders nothing at all — all of that is shipped behaviour, not a
choice on this page.

The figures are illustrative but self-consistent: 19,846 counted, about 9,300
out, a 393 margin, 8,412 / 8,019 for the top two, and a settled count of 12,904
/ 12,188 of 25,092.

```bash
cd packages/dashboard
./node_modules/.bin/tailwindcss -c tailwind.config.ts -i src/styles/index.css \
  -o /tmp/chance.css \
  --content "../../docs/mockups/proposals/chance-card.html"

# inline /tmp/chance.css into the <style> block, then capture 1400×3838 at 2x
# (the height is document.documentElement.scrollHeight; re-measure after copy
# changes — an over-tall window pads the bottom with the page background)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1400,3838 --virtual-time-budget=12000 \
  --screenshot=chance-card.png \
  "file://$PWD/../../docs/mockups/proposals/chance-card.html"
```
