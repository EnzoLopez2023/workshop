# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Client Authority

Workshop web is the only canonical supported client and remains live at
<https://workshop.nintek.com>.

The historical Workshop-for-iOS client was sole-user and TestFlight-only, was never publicly
released, and is now archived/read-only at retirement main SHA
`bcf46a91cdbc95b2b1c0e4a5c585c76369051828`. Its final functional source was
`5be546524e79b9c63b2a4effb5ec24e03fe6d777`, version 2.3.0 (15). All 16 TestFlight builds
are expired, the beta group is deleted, and there is no public listing or current submission.
It is not an active product or parity target.

NintekKit's `WorkshopAPI`, models, and `CutPlan` remain frozen public compatibility surfaces.
The web cut-plan implementation may evolve independently. This retirement changes no shared
backend behavior and does not authorize removing any compatibility path. Dormant Apple
authentication, Apple refresh-token storage/revocation, provider-scoped Apple database
compatibility, account deletion, and historical accounts remain supported until a separately
approved phase.

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
- **Bambu Hub.** A parallel 3D-print project library for MakerWorld, Thingiverse, and
  Printables links. Workshop keeps source attribution, locally copied public images,
  downloadable STL/3MF/CAD attachments, and durable warnings when a provider requires
  authentication. An official Thingiverse token can be encrypted per user from Settings;
  MakerWorld credentials are never collected, and protected originals can be uploaded
  manually after download. A personal, sideloaded Safari bridge may use the owner's
  existing MakerWorld browser session to hand Workshop short-lived signed file URLs;
  it is unofficial, opt-in, and absent unless the companion extension is installed.
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
- The supported web sign-in is Azure AD (MSAL); there are no passwords. Microsoft accounts use
  per-user SQLite files keyed by their provider identity, while dormant Apple-backed account
  compatibility remains in the shared backend.
- Demo mode (`X-Demo: 1`) is unauthenticated, read-only, and blocks writes in the browser
  before they leave the client.
- Light and dark themes both ship and both must work; the preference persists in
  `localStorage` and defaults to the OS setting, applied pre-paint by an inline script in
  `index.html`.
- Deployed as a Linux container on Azure App Service. Frontend env vars are baked at build
  time, so anything visual must be static-buildable.
- The Node test suite covers auth/data isolation, account deletion, cut-plan behavior, core
  workflows, route/shell contracts, and the remaining web surfaces. `npx tsc -b` and
  `npm run build` are additional automated gates; no linter is configured. TypeScript runs
  `strict` + `noUnusedLocals` + `noUnusedParameters`.
- Route components load lazily behind a shared Suspense/error boundary. The initial production
  application chunk remains below 250 kB before gzip; page-heavy code such as Notebook Markdown
  rendering loads only when its route opens.
- Existing dependencies available for UI work: `framer-motion`, `lucide-react`, `sonner`,
  `cmdk`, `@dnd-kit/*`, `@floating-ui/react`, `marked`.

## Brand Commitments

- **Name:** Workshop. The hammer is the identifying mark; "Project Companion" may appear as
  supporting product copy, not as a replacement name.
- **Web direction:** The shipped **Living Plan Table** language uses a cool vellum
  canvas, deep spruce structure, pencil-blue annotation, restrained amber next-action emphasis,
  a subtle 24px drafting grid, layered project plans/photos, and functional glass only where
  navigation, selection, or tracing requires it.
- **Historical iOS direction:** The retired client used the same visual language with native
  SwiftUI navigation and material. This is historical context, not an active cross-platform
  requirement.
- **Web platform behavior:** Use semantic landmarks, persistent URLs, links, browser history,
  native form behavior, visible keyboard focus, and responsive sidebar/bottom navigation. Web
  never simulates iOS chrome or gestures.
- **Companion products:** Tabloom (notebook source) and Shopkeep (tool inventory, linked when
  `VITE_SHOPKEEP_URL` is set) are real sibling apps by the same owner.
- **Retired directions:** warm-paper/editorial-serif/terracotta and the later Concourse Board
  metaphor, condensed board lettering, split-flap decoration, steel bands, tiny radii, and
  aggregate metric walls must not return.

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

Phone use happens in a real workshop: bright or variable light, dusty hands, and occasional
gloves. Interactive targets are at least 44px, state never relies on color alone, and the compact
shell keeps destinations reachable without hover. Dark mode is a genuine requirement, not a
toggle for show. The web surface follows system appearance by default, retains the existing
`workshop-theme` and `workshop-settings` storage contracts, and provides reduced-motion,
reduced-transparency, forced-colors, and print adaptations.
