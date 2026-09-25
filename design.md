# Design — Election Night (NZ general election tracker)

Locked design system. Pages defer
to it. Amend intentionally — the file is the rule.

## System
- Genre · editorial (newsroom — this is a count-night, not a SaaS dashboard)
- Macrostructure · Workbench (app shell): masthead + data views + live rail
- Theme · catalog: Newsprint (printed edition — grey-white stock, press ink,
  masthead red; not warm book-paper browns)
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
  --color-paper:      oklch(94% 0.006 80);   /* hsl(60 9% 94%)  */
  --color-paper-2:    oklch(91.5% 0.006 80); /* hsl(60 8% 90%)  */
  --color-paper-3:    oklch(87% 0.007 80);   /* hsl(50 7% 86%)  */
  --color-ink:        oklch(12% 0.012 80);   /* hsl(40 6% 13%)  */
  --color-ink-2:      oklch(24% 0.010 80);
  --color-rule:       oklch(80% 0.006 80);   /* hairline        */
  --color-rule-2:     oklch(45% 0.008 80);   /* heavier rule    */
  --color-muted:      oklch(40% 0.012 80);   /* reads at 4.5:1 on paper */
  --color-accent:     oklch(48% 0.16 30);    /* masthead red    */
  --color-accent-ink: oklch(97% 0.005 70);
  --color-focus:      oklch(50% 0.18 30);

  --font-display: "Playfair Display", Georgia, serif;
  --font-body:    "Crimson Pro", Georgia, serif;
  --font-label:   "Inter", system-ui, sans-serif;
  --font-mono:    "IBM Plex Mono", ui-monospace, monospace;

  /* night edition (dark mode) — warm ink paper, red lifts */
  /* .dark: background hsl(40 8% 9%), foreground hsl(55 8% 90%),
     primary hsl(14 72% 58%), muted-foreground hsl(50 5% 60%) */

  --radius-card: 0px; --radius-pill: 0px; --radius-input: 0px;
}
```

## Voice
- **The medium is stock, not screen.** Cards are hairline panels; shadows are
  off; radius is 0. A 5% fractal-noise grain over the page says "paper".
- **Red is the only accent** — reserved for LIVE state, cut lines, leader
  changes, chips, focus rings, and the masthead. Everything else is ink on paper.
- **Data is set in mono, labels in Inter, prose in Crimson Pro, display in
  Playfair.** Tables rule-based, figures tabular. Party colours are data
  semantics and stay untouched (National #00529F, Labour #D82A20, Green
  #098137, ACT #FFD700, NZ First #333, TPM #000, TOP #4B0082).
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
