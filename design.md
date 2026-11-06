# Design — Election Night (NZ general election tracker)

Locked design system. Pages defer
to it. Amend intentionally — the file is the rule.

## System

- Genre · editorial (newsroom — this is a count-night, not a SaaS dashboard)
- Macrostructure · Workbench (app shell): masthead + data views + live rail
- Theme · catalog: Newsprint (printed edition — grey-white stock, press ink,
  masthead red; not warm book-paper browns)
- Section mastheads · a section big enough to want one inside a page — Close
  Calls inside Seats — uses `.pagehead.pagehead--section`: the page head's rule
  and display size (Playfair, `clamp(1.75rem, 3.5vw, 2.25rem)`, −0.015em) set as
  an `h2`, one level down in the document outline. It reads as its own front
  page without competing with the `h1`, and it is the only place a heading below
  the page head takes that size: everything else under a page head is a subhead.
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

## Tokens (canonical · `packages/dashboard/src/styles/index.css` is the source of truth)

```css
:root {
  /* light edition — printed newspaper */
  --color-paper: oklch(94% 0.006 80); /* hsl(60 9% 94%)  */
  --color-paper-2: oklch(91.5% 0.006 80); /* hsl(60 8% 90%)  */
  --color-paper-3: oklch(87% 0.007 80); /* hsl(50 7% 86%)  */
  --color-ink: oklch(12% 0.012 80); /* hsl(40 6% 13%)  */
  --color-ink-2: oklch(24% 0.01 80);
  --color-rule: oklch(80% 0.006 80); /* hairline        */
  --color-rule-2: oklch(45% 0.008 80); /* heavier rule    */
  --color-muted: oklch(40% 0.012 80); /* reads at 4.5:1 on paper */
  --color-accent: oklch(48% 0.16 30); /* masthead red    */
  --color-accent-ink: oklch(97% 0.005 70);
  --color-focus: oklch(50% 0.18 30);

  --font-display: 'Playfair Display', Georgia, serif;
  --font-body: 'Crimson Pro', Georgia, serif;
  --font-label: 'Inter', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  /* night edition (dark mode) — warm ink paper, red lifts */
  /* .dark: background hsl(40 8% 9%), foreground hsl(55 8% 90%),
     primary hsl(14 72% 58%), muted-foreground hsl(50 5% 60%) */

  --radius-card: 0px;
  --radius-pill: 0px;
  --radius-input: 0px;
}
```

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

## Exports

`packages/dashboard/src/styles/index.css` is the source of truth (HSL
shadcn-compatible variables + utility layer). Tailwind config mirrors fonts,
radius, and keyframes in `packages/dashboard/tailwind.config.ts`.
