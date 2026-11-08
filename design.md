# Design — Election Night (NZ general election tracker)

Locked design system: pages defer to it. Amend intentionally; the file is the
rule.

## System

- Genre · editorial (newsroom — this is a count-night, not a SaaS dashboard)
- Macrostructure · Workbench (app shell): masthead + data views + live rail
- Theme · catalog: Newsprint (printed edition — grey-white stock, press ink,
  masthead red; not warm book-paper browns)
- Page-head spacing · the shell's top padding (`pt-3 sm:pt-4 lg:pt-5`) plus
  `.pagehead`'s `0.5rem` top padding is the whole distance from the nav rule to
  the title, about 20–28px. The head is the first thing in every page, so a
  second gap there is only blank paper, not breathing room.
- Page-head control · a page whose `h1` carries a boxed control (an open
  electorate's Candidate/Party switch) uses `.pagehead.pagehead--control`,
  which centres the control on the title's line so it reads level with the word
  and the rule still spans the page. The default baseline alignment hangs a
  44px target through the rule, and a flex row around a narrowed head cuts the
  rule short.
- Map controls float, not the row · the electorates map's search and roll switch
  sit in a hairline row in the map card until a seat is open, then fold to one
  `Search` button on a paper panel floating over the map's top right. A floating
  control is one the reader has already acted on and can put away; the landing
  state keeps the row. The panel is anchored right and stops short of the
  top-left corner, which belongs to the zoom buttons, so opening the search
  never covers them. It closes on Escape, on choosing a seat, and on a click
  anywhere else, so it never covers the map the reader went back to. There is no
  Clear button in either state: the nav entry, the back button and picking
  another seat already clear the selection.
- Axes · grey-white newsprint / high-contrast serif display / masthead red
- Colour mode · manual toggle, persisted in `localStorage`
  (`election-night:theme`). **Light is the default** and the OS
  `prefers-color-scheme` is deliberately ignored. `ThemeToggle` adds/removes the
  `dark` class on `<html>`; an inline `<head>` script applies a saved choice
  before first paint so there is no flash.

## Tokens

`packages/dashboard/src/styles/index.css` is the source of truth:
shadcn-compatible HSL variables, plus the `pagehead`, `chip-print` and
`stat-grid` utilities. Tailwind config mirrors the fonts, radius and keyframes.

| Token                | Light (Newsprint) | Dark (night edition) |
| -------------------- | ----------------- | -------------------- |
| `--background`       | `60 9% 94%`       | `40 8% 9%`           |
| `--foreground`       | `40 6% 13%`       | `55 8% 90%`          |
| `--primary`          | `14 55% 38%`      | `14 72% 58%`         |
| `--muted`            | `60 8% 90%`       | `40 8% 17%`          |
| `--muted-foreground` | `45 6% 37%`       | `50 5% 60%`          |
| `--border`           | `50 5% 80%`       | `40 8% 24%`          |
| `--ring`             | `14 55% 38%`      | `14 72% 58%`         |
| `--radius`           | `0px`             | `0px`                |

Fonts: Playfair Display (display), Crimson Pro (body), Inter (labels), IBM Plex
Mono (data).

## Voice

- **The medium is stock, not screen.** Cards are hairline panels; shadows are
  off; radius is 0. A 5% fractal-noise grain over the page says "paper".
- **Red is the only accent** — reserved for LIVE state, cut lines, leader
  changes, chips, focus rings, and the masthead. Everything else is ink on paper.
- **The character is the one exception.** The mascot — masthead mark and install
  icons alike — is drawn in the Electoral Commission's Orange Guy orange, the
  colour of the enrolment mascot it quotes: centred on `#FF7300`, shaded
  `#FF8000 → #FF6600` with both stops at full lightness. It went masthead red
  (`#C8503E → #9E2B1C`) once and stopped reading as the character. It stays
  artwork: the mascot never sets type, state, chips or leader markers, so the
  accent rule above is untouched. `components/Logo.test.tsx` and
  `lib/app-icons.test.ts` pin the pair.
  The shape is a blob holding a flag in each hand, and **nothing else** — no
  ears, no tufts, no hat. A pointed ear once sat on each side of the head: the
  left one read as a horn, and the right one as a dent, so the character stopped
  being the thing it quotes. Both are gone, in `Logo.tsx` and in the artwork
  `scripts/generate-icons.mjs` keeps for the icons, and both tests count the
  shapes drawn in the body's ink (one body, two arms) so a protrusion cannot be
  added back quietly.
- **Data is set in mono, labels in Inter, prose in Crimson Pro, display in
  Playfair.** Tables rule-based, figures tabular. Party colours are data
  semantics and stay untouched (National #00529F, Labour #D82A20, Green
  #098137, ACT #FFD700, NZ First #333, TPM #000, TOP teal #00B9BC).
- **Table type runs a step above the rest** — 1rem in the cell (1.125rem in the
  parliament table, which is set larger on purpose), 0.875rem for a header
  label and for a cell's second line (party name under a candidate, a
  majority's share), and `.chip-print--table` / `.kicker--table` where a chip
  or a kicker stands inside a row: a 0.625rem chip beside 1rem cells reads as
  fine print, not as a marker. Anything else set inside a table follows the
  same rule, so no row is half body type and half footnote. Below `sm` every
  table size drops one pixel — 1rem → 0.9375rem in the cell, 0.875rem →
  0.8125rem for the header and the compact seat table — because at desktop
  sizes a four-column table wraps names and scrolls sideways on a 390px phone.
  The step lives in `TABLE_TEXT`, `TABLE_TEXT_LG`, `TABLE_TEXT_COMPACT` and
  `TH_CLASS` (`components/Table.tsx`), never at a call site.
- **Table rows and figures share one shell** — every data table uses the same
  hairline row rule and `hover:bg-muted/30` tint, numeric cells are mono and
  right-aligned (`TR_ROW`, `NUMERIC` and `NUMERIC_CELL` in
  `components/Table.tsx`), and the chance of holding a seat is printed by
  `WinPercentValue` everywhere. The seat panel's larger Playfair number is that
  component's `feature` variant, not a second style. Every table is framed:
  flush tables wear `TABLE_FRAME`, while the Parliament and electorate tables
  sit inside their panel's border rather than adding a second one. The
  Parliament table is the only reorderable one, so its draggable rows carry
  Material Design's six-dot `drag_indicator` grip in muted ink
  (`DragGrip.tsx`) and a grab cursor: 8px wide, so the affordance never costs
  the phone a column or a name's worth of width.
- **Table heads stick under the masthead** — every head cell is `TH_STICKY`,
  parked at `top: var(--masthead-height)`, which `Layout` measures and publishes
  so the head sits against the 56px phone bar and the ~93px bar above `sm`
  rather than under either. Two pieces are load-bearing. The bottom hairline is
  an inset shadow, not the row's `border-b`, because `border-collapse` paints a
  collapsed rule in table coordinates and it stays behind when the head sticks.
  And every sideways scroller is `TABLE_SCROLL` (`overflow-x-auto
overflow-y-clip`): an `auto` vertical axis would make the scroller the sticky
  cells' reference and the head would scroll away, while `clip` leaves the
  vertical axis to the page. `TH_PINNED` / `TH_PINNED_MOVED` are the frozen
  first column's head — one layer above the other heads so a header never
  slides under a header.
- **A folded figure keeps the words that name it** — where a phone folds a
  numeric column into its neighbour (Flipped's `won by 2,392` over `9.2%`, and
  `leads by 8,412` in the next cell), the words are set in the label face at the
  cell's second-line 0.8125rem, the figure takes the cell's own 0.9375rem in
  mono, and the share sits at 0.8125rem beneath. That gives the cell two sizes,
  the same step the desktop cell has (1rem over 0.875rem). An 11px label over a
  14px figure over a 13px share left the count and its own share a pixel apart
  and read as fine print around a number. Two bare figures side by side read as
  one quantity, so the words stay.
- **A count says what kind of measure it is.** The seat band's four fixed
  labels are `Voting places reported` (the contributing set, which may include
  advance hubs standing in another electorate), `Counted`, `Margin` and
  `Estimated ordinary votes remaining tonight`. When every contributing place
  has reported the fourth cell reads `Ordinary count complete`; the line under
  the ordinary bar reads `Election-night count complete`. The ordinary bar keeps
  that meaning through completion: specials get their own labelled row,
  `Estimated specials to be counted later`, on a distinct bar and denominator.
  The map's ledger says `booths in this electorate`, because 24 of 24 booths
  inside a seat is not 90 of 102 contributing places. A missing forecast prints
  `Estimate unavailable`, never zero and never `No votes counted yet` when votes
  are known. No page derives its own version of these numbers.
- **A history warning is a hairline status line, not a modal.** When history is
  stale, unavailable or failed, `HistoryStatus` prints one sentence in muted
  ink on a bordered row beside the chart, with a `Retry` chip. The rows stay on
  screen; the note says they are not current, and it never replaces the count
  panel or opens a dialog. `unavailable` means no usable answer; `stale` means
  the last verified answer is being shown. The same component is used by Trends
  and the electorate panel, so the wording cannot fork.

- **Popups, maps, tooltips, and the bottom sheet stay** — they carry the
  information. They are restyled (square, hairline, serif), never removed.
- No functionality is traded away for the look.

## CTA voice

- Primary · ink fill (`bg-foreground text-background`) · square · tight
- Secondary · hairline outline (`border-border` + hover `bg-muted/40`) · square
- Active segmented control = ink fill; inactive = hairline

## Motion stance

- Silent — one reveal primitive (`fade-in-up` stagger), no bounce, no parallax
- Reduced-motion fallback · ≤150 ms opacity crossfade (global media query)

## Masthead

The masthead is the front page's flag: masthead rule, wordmark, nav, live
state, and the dateline strip beneath them.

- The dateline runs `NZ General Election` on the left and the distance to
  polls close on the right — `Polls close in 4h 12m`, counting down to seconds
  inside the final hour. It is a less idle thing to glance at than a clock.
- Once the doors shut (7:00pm on election day) the strip switches to
  `● Polls closed · counting` in masthead red — the same dot and pulse as
  `LiveIndicator`. Counting stops being a claim after election night, so a
  past cycle falls back to the plain date and time, as does a cycle with no
  known close instant or an unreachable server.
- The close instants live in `packages/core/src/polls-close.ts`, derived from
  `ELECTION_YEAR`; the server publishes them on `GET /api/config` so a new
  cycle needs no frontend rebuild. The countdown runs off the visitor's clock,
  not the server's: a server clock that is wrong would put every visitor hours
  out, while a wrong device clock only affects the person holding it.
- Set in Inter, uppercase, tabular numerals, muted — masthead red only for the
  counting state.
- The wordmark is shown only when the whole of it fits beside the menu. There is
  a band of widths, from the menu appearing horizontally to the masthead sitting
  comfortably, in which the row cannot hold the mark, the wordmark and the menu
  together; the browser's only remedy on the text is an ellipsis
  (`election-n…`), which reads as broken rather than as a smaller masthead. The
  wordmark is measured against the space the menu leaves and dropped for the
  logo alone when a letter would go — the icon and the menu still say whose page
  it is. The measurement comes from an invisible copy laid out outside the flow,
  because measuring the wordmark itself would be self-defeating: hiding it frees
  exactly the space whose absence said it did not fit.
