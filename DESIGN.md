---
name: The Workshop
description: A woodworking shop record read like a Solari departure board.
colors:
  concourse: "#DDE3E0"
  flap: "#F7F9F6"
  flap-shade: "#E5EAE6"
  ink: "#14181A"
  muted: "#59686A"
  line: "#C0CAC6"
  steel: "#2B3238"
  steel-dark: "#1A2025"
  steel-light: "#47535B"
  on-steel: "#EDF1EE"
  amber: "#8A4F00"
  amber-fill: "#FFB400"
  amber-deep: "#C77800"
  green: "#2E7148"
  green-fill: "#46A46A"
  red: "#B3271F"
  red-fill: "#D3392F"
  flap-face: "#2E363B"
  flap-face-lo: "#232A2E"
  flap-letter: "#F2F4F1"
typography:
  display:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "clamp(1.45rem, 3.2vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.005em"
  board-caps:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.66rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.06em"
  rail:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.66rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.11em"
  readout:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.62rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.13em"
rounded:
  flap: "2px"
  panel: "3px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "26px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.amber-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.board-caps}"
    rounded: "{rounded.flap}"
    padding: "9px 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.amber-deep}"
    textColor: "#FFF6E4"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.board-caps}"
    rounded: "{rounded.flap}"
    padding: "9px 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.flap-shade}"
  rail:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.on-steel}"
    typography: "{typography.rail}"
    padding: "9px 14px"
  card:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
  flapcell:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.flap-letter}"
    typography: "{typography.readout}"
    rounded: "{rounded.flap}"
    padding: "0"
  flag-amber:
    backgroundColor: "{colors.amber-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.flap}"
    padding: "4px 8px"
  flag-green:
    backgroundColor: "{colors.green-fill}"
    textColor: "#08150D"
    typography: "{typography.label}"
    rounded: "{rounded.flap}"
    padding: "4px 8px"
  flag-idle:
    backgroundColor: "{colors.flap-shade}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.flap}"
    padding: "4px 8px"
  chip:
    backgroundColor: "{colors.flap-shade}"
    textColor: "{colors.ink}"
    rounded: "{rounded.flap}"
    padding: "5px 9px"
  input:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.flap}"
    padding: "10px 12px"
---

# The Workshop — Design System

## Overview

**Concourse Board.** The Workshop reads a shop the way a traveller reads a Solari
departure board: what's moving, what's queued, what's done, all legible from across
the room. Every project is a row that flips into its new state. The board's own
anatomy — the split line across a flap, the cell divider, the brushed steel frame,
the rivet — *is* the layout. It is not applied decoration.

The world ships in two renditions. **Light** is a lit terminal hall: cool grey-green
concourse, bone flap faces, graphite frames. **Dark** is the board's native night
form. The two are the same object under different lighting, not two themes.

One rule anchors everything: **the board must read as a board with animation
disabled.** Split lines, cell grid, steel frames and tracked caps are structural at
rest. The split-flap roll is a single authored moment on the dashboard readout; it is
sugar on top of a structure that already tells the story.

This world is a deliberate replacement for a warm-paper / editorial-serif /
terracotta arrangement. Cream grounds, rust accents, Playfair Display, italic accent
phrases, emoji icons, sparkle "AI" affordances and 999px pills are **retired
permanently** — see PRODUCT.md. Do not reintroduce them.

## Colors

| Token | Light | Dark | Role |
|---|---|---|---|
| `concourse` | `#DDE3E0` | `#0C0F10` | Page ground — the hall the boards hang in |
| `flap` | `#F7F9F6` | `#171B1D` | Card surface — a flap face |
| `flap-shade` | `#E5EAE6` | `#101415` | Recessed fill, hover state, the shaded lower half of a flap |
| `ink` | `#14181A` | `#EFF2ED` | Primary lettering |
| `muted` | `#59686A` | `#8B9794` | Secondary lettering, labels |
| `line` | `#C0CAC6` | `#2C3335` | Cell divider — always 1px |
| `steel` | `#2B3238` | `#39434A` | Rail, header band, frame |
| `steel-dark` | `#1A2025` | `#232B30` | Frame edge, board border |
| `steel-light` | `#47535B` | `#566269` | Top-lit edge of a steel band |
| `on-steel` | `#EDF1EE` | `#EDF1EE` | Lettering that sits on steel — same in both renditions |

**Signals.** Each signal is a pair: a `-fill` (the lamp itself) and a plain token (that
same signal made legible as text on the current ground).

| Signal | Fill | Light ink | Dark ink | Means |
|---|---|---|---|---|
| Amber | `#FFB400` | `#8A4F00` | `#FFC24D` | Active, in progress, the one available action |
| Green | `#46A46A` | `#2E7148` | `#6BC48D` | Complete, purchased, confirmed, money |
| Red | `#D3392F` | `#B3271F` | `#F0736A` | Cancelled, destructive, failed |

**Flap modules are graphite in both renditions.** `flap-face #2E363B`,
`flap-face-lo #232A2E`, `flap-letter #F2F4F1`. A real Solari module is dark with light
lettering whether the hall is lit or not. Signal lettering inside a module brightens
to `#FFB400` / `#6BC48D` / `#F0736A`.

**Amber is scarce by design.** It marks the single primary action in a view, the
current route lamp in the header, and in-progress status. It is never a decorative
tint, never a whole table column, never two solid buttons competing in one band.

**The signal lamp is user-selectable.** Settings → Signal Lamp swaps the accent
across the app (Amber, Signal, Platform, Beacon, Violet). `SettingsContext` writes
`--color-amber` / `--color-amber-deep` / `--color-amber-fill` inline on `:root` and
re-applies on every `data-theme` change, because the ink differs between renditions.

## Typography

Two faces, no third.

- **Martian Mono** (`--font-board`) — every piece of board lettering: headings,
  labels, rails, buttons, chips, status flags, and all numeric readouts. Always
  uppercase in that role. Width is set with `font-stretch: 76–88%` (the `@font-face`
  declares a stretch range; **never** use `font-variation-settings: 'wdth' N`).
- **Archivo** (`--font-ui`) — body prose, descriptions, form help. Sentence case,
  normal width, `max-width: 68ch` via `.measure`.

**Zero serif, zero italic.** No accent phrase is ever set in italic. The stamped plate
at the foot of a page (`.board-plate`) is tracked caps, not a cursive flourish.

Numbers use `font-variant-numeric: tabular-nums` everywhere (`.readout`, `tbody td`).
Counts on a rail are zero-padded to two digits (`06`, not `6`) — a board never shows
a bare digit.

Key classes: `.board-caps` (labels, chips, buttons), `.readout` (values), `.rail`
(steel headings), `.label-caps` (form field labels), `.page-title`, `.measure`.

## Layout

- **Page column.** `.page-container` — routes narrow it further inline (680px for
  Settings, 780px for lists, 820–900px for forms and details).
- **The hall.** `PageBackground` paints an authored CSS cell grid — never photography.
  Route changes shift the board horizontally; the chrome persists, the content inside
  the frame changes. This is the committed staging: a *carried object*.
- **Page head.** `.page-head` — title in board caps over a 2-tone rule (1px steel with
  a 1px light lip 3px below, mimicking a flap seam). Actions sit right in
  `.page-head-actions`. The dashboard has no page title at all: it opens straight onto
  `SHOP BOARD`, which is the strongest possible statement of the world.
- **Boards.** `.board` = 1px `steel-dark` frame + `.rail` header + rows divided by 1px
  `line`. **The rail is the heading** — there are no eyebrows or kickers above
  headings anywhere in this system.
- **Breakpoints.** 900px (grid collapse), 760px (header wraps to two rows, board rows
  stack, `.depart-foot` compresses), 520px (single column).
- **Mobile.** The shop-in-hand case is real: cut lists get horizontal scroll
  (`.table-scroll`), touch targets stay ≥36px, board rows reflow to stacked with the
  trailing icon pinned.

## Elevation & Depth

Depth comes from **material**, not from blur stacks.

- `--steel-face` is a two-layer background: a 1px repeating vertical grain over a
  top-lit `steel-light → steel → steel-dark` gradient. Every rail, header band and
  table head wears it.
- `--shadow-steel` — `inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 0 rgba(20,24,26,0.22)`.
  A lit top edge and a hard bottom lip: steel catching light, not a soft glow.
- `--shadow-card` / `--shadow-card-hover` — a 1px hard offset plus a tight, tightly
  clipped ambient. Cards sit *on* the board, they do not float above it.
- **The seam** (`.flap-seam::after`) — a 1px `--color-split` line across the vertical
  centre with a `--color-split-lip` highlight below it. This is the single most
  identifying mark in the system. Flap cells, status flags and readouts carry it.
- **Rivets** (`--color-rivet`) — 2px dots inset at the corners of steel bands.

## Shapes

**The board cuts, it does not round.** `--r-flap: 2px` for anything flap-sized
(buttons, chips, flags, cells, inputs, checkboxes); `--r-panel: 3px` for boards and
cards. Nothing in this system exceeds 3px. There are no circles, no pills, no
`border-radius: 50%` — a colour dot is a small square lamp, a close button is a cut
square.

Dividers are always exactly 1px. Frames are 1px `steel-dark`. There is no such thing
as a 3px coloured accent border on a card in this system.

## Components

**`SplitFlap`** (`src/components/SplitFlap.tsx`) — the signature. Rolls each column
through a drum of `A–Z 0–9 . , : $ - / +`, max 5 steps at 55ms, columns staggered
45ms apart. State lives in a `displayRef` mirror so timeout scheduling stays out of
the state updater (React StrictMode double-invokes updaters); a per-cell `ticks`
counter is the remount key that restarts the CSS `flap-fall` animation. The accessible
value lives in a `.sr-only` span and the cells are `aria-hidden`. `useReducedMotion`
and `@media (prefers-reduced-motion: reduce)` both collapse it to an instant swap.

**`.rail`** — steel band, tracked caps, optional `.rail-count` (amber, zero-padded)
or `.rail-actions` (translucent-white ghost buttons that read on steel).

**`.card` / `.depart-*`** — a project renders as a departure card: status flag
top-right, title in tracked caps, description, then a three-column data footer of
`label / value` cells divided by 1px rules.

**`.pill` + `.flag-*`** — status is a signal flap, never a rounded badge:
`flag-amber` (in progress), `flag-green` (complete), `flag-red` (cancelled),
`flag-steel`, `flag-idle`.

**`.flapboard` / `.flapcell`** — the dashboard readout. Graphite modules with light
lettering and a seam, in both renditions.

**`.lamp`** — the Settings accent picker. A square of lamp glass with an inset
bottom-shade and top highlight, labelled beneath, `aria-pressed` for state.

**Form controls** — `select` gets a hand-drawn 5px chevron built from two gradients
and board-caps type; `input[type=checkbox]` is a cut flap that fills green and stamps
a CSS check when set. No native OS control styling survives.

**Tables** — `thead tr` always wears `--steel-face` with `on-steel` lettering; `tbody
td` is tabular-nums. This is global, not per-table.

**Print** — the cut list and shopping list print as monospace manifests: steel column
heads, hairline rules, zebra rows, a `Measure twice · Cut once` plate. System mono
(`ui-monospace`), because web fonts are unreliable in a print window.

## Do's and Don'ts

**Do**

- Let the rail be the heading. Add `.rail` to a `.board`; never stack a label above it.
- Zero-pad every count and quantity shown on a board (`06`, `12H`, `$1353`).
- Keep amber to one primary action per view, the current-route lamp, and in-progress.
- Use `font-stretch: N%` for width; the variable fonts declare stretch ranges.
- Reach for `.board-caps`, `.readout`, `.rail`, `.label-caps`, `.board-plate` before
  writing a new inline type style.
- Give every new motion a `prefers-reduced-motion` escape.

**Don't**

- Don't add an eyebrow, kicker, or `◆`-style ornament above a heading. Banned outright.
- Don't round anything past 3px. No pills, no circles, no `50%`.
- Don't introduce a serif, an italic, or a third typeface.
- Don't reintroduce cream `#F5F0EA`, rust `#A0522D`, Playfair Display, sepia photo
  backdrops, emoji icons, or sparkle-icon "AI" copy — those are the retired identity.
- Don't tint a whole table column amber; amber is a signal, not a text colour.
- Don't put a coloured `border-left` thicker than 1px on a card.
- Don't build page structure out of a row of same-size icon + heading + text cards.
  Use board rows.
- Don't hardcode a hex in a component. Every colour resolves from a token; the signal
  lamp is user-swappable and hardcoding breaks it.
