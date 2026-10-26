# Proposals

Hand-built mockups, not captures. The parent folder holds captures of the
running application (see [`../README.md`](../README.md)); these are static HTML
drawn ahead of implementation, so review them as a proposal — the tokens,
utilities and component classes are the real ones, the markup is not the
component.

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

