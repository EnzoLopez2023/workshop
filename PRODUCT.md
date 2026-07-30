# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One primary user: the owner, a hobbyist woodworker. Confirmed scene of use — planning at a
desk or laptop before a build, then occasionally pulling up a cut list or material list on a
phone while standing in the shop. Desk-first, phone-second. The app is multi-user by
architecture (any valid tenant Microsoft account gets its own isolated database), but it is
not marketed and has no signup funnel; additional accounts are incidental, not an audience.

An unauthenticated **demo** visitor is a real, supported second audience: read-only, seeded
from a shared snapshot, reached from the landing page.

## Product Purpose

Keep every woodworking project — from first idea to finished piece — in one place, so nothing
about a build lives only in the maker's head or on a scrap of paper. A project holds its
description, status, inspiration images, cut list, material list, build log with photos, and
finish records. Success is that when the owner returns to a half-finished build weeks later,
or wants to rebuild something from two years ago, everything needed is still there and still
accurate.

## Positioning

Two mechanisms a neighboring notes-app or spreadsheet could not truthfully copy:

1. **Paste a URL, get a project.** `/api/projects/analyze-url` and
   `/api/shaper-projects/analyze-url` send a plan page (Kreg, Ana White, Shaper Origin, etc.)
   to Claude and return a structured project: title, difficulty, wood types, cut list parts
   with real dimensions, and materials — pre-filled and editable.
2. **A cut list that becomes a cutting plan.** `src/lib/cutPlan.ts` runs a real board-layout
   optimizer over the parts, accounting for kerf, stock length, and grain, and renders the
   boards it would buy plus the offcuts it would leave.

Neither is a generic "AI feature"; both convert something the maker already has (a link, a
parts list) into something they'd otherwise do by hand.

## Operating Context

- **Workflow.** Capture idea → paste plan URL or hand-enter → refine cut list and materials →
  generate cut plan → shop for materials via the consolidated Shopping List → log the build
  with photos → record the finish schedule (stain, topcoat, notes).
- **Shaper Hub.** A parallel project type for Shaper Origin CNC work, with its own parts,
  bit info, and SVG/design files. Shaper projects and regular projects share the
  `cut_list_items` table but never both at once (DB `CHECK` constraint).
- **Notebook.** An editable window onto a separate product, Tabloom. Pages are fetched and
  written over `/api/integrations/workshop/*` as Markdown; there is no local notebook store.
- **Conversion tables.** mm ↔ inches and fractional reference tables plus a live calculator,
  because plans arrive in both systems.
- **Templates.** Any project can be saved as a template and cloned into a fresh project.
- **Command palette.** ⌘K / Ctrl-K global search and navigation.
- **Real materials.** The subject matter is dimensional lumber, sheet goods, fasteners,
  kerf widths, board feet, grain direction, stain and topcoat schedules.

## Capabilities and Constraints

- React 19 + Vite + Tailwind v4 + React Router v7 frontend; single-file Express + SQLite
  backend (`server.js`). No state library — each page fetches its own data.
- Auth is Azure AD (MSAL) only; there are no passwords. Per-user SQLite files keyed by OID.
- Demo mode (`X-Demo: 1`) is unauthenticated, read-only, and blocks writes in the browser
  before they leave the client.
- Light and dark themes both ship and both must work; the preference persists in
  `localStorage` and defaults to the OS setting, applied pre-paint by an inline script in
  `index.html`.
- Deployed as a Linux container on Azure App Service. Frontend env vars are baked at build
  time, so anything visual must be static-buildable.
- **No tests and no linter exist.** `npx tsc -b` / `npm run build` are the only automated
  gates. TypeScript runs `strict` + `noUnusedLocals` + `noUnusedParameters`.
- Existing dependencies available for UI work: `framer-motion`, `lucide-react`, `sonner`,
  `cmdk`, `@dnd-kit/*`, `@floating-ui/react`, `marked`.

## Brand Commitments

- **Name:** "The Workshop", subtitle "Project Companion". Confirmed, keep.
- **Companion products:** Tabloom (notebook source) and Shopkeep (tool inventory, linked when
  `VITE_SHOPKEEP_URL` is set) are real sibling apps by the same owner.
- **Binding visual constraint given by the user for this work:** the incumbent
  cream/beige-plus-rust-plus-Playfair look is explicitly rejected as generic AI output. The
  replacement must have a palette of its own. No other visual commitment exists.

## Evidence on Hand

- Real product screens and data model for every feature listed above.
- `public/bg-*.jpg` — seven AI-generated sepia workshop photographs currently used as page
  backdrops. Synthetic; not photographs of the owner's actual shop.
- No testimonials, no customers, no pricing, no benchmarks, no press. None may be invented.
- No photography of the owner's real projects is available to this repo.

## Product Principles

1. **The record outlives the build.** Anything entered must still be findable and legible
   years later; that outranks any momentary flourish.
2. **Real shop units, always.** Fractions, kerf, board feet and millimetres are first-class;
   never round away a measurement to make a layout tidy.
3. **Desk to bench without a translation step.** The same project reads at a laptop while
   planning and on a phone held at arm's length in a workshop.
4. **Structure arrives pre-filled, never pre-decided.** Imported and optimized results are
   always editable; the maker has the last word.
5. **One owner's shop, not a social product.** No feeds, streaks, badges, or audience
   pressure.

## Accessibility & Inclusion

Phone use happens in a real workshop: bright/variable light, dusty or gloved hands. Touch
targets and contrast must hold up in that scene. Dark mode is a genuine requirement, not a
toggle for show. `prefers-reduced-motion` is already honored by `PageBackground`.
