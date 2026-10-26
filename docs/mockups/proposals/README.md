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
