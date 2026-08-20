---
name: Workshop
description: A browser-native living plan table that keeps the active woodworking project and its next useful move in view.
colors:
  canvas: "light-dark(#EEF4F2, #0C1513)"
  recessed: "light-dark(#E0EBE7, #12201D)"
  surface: "light-dark(#FAFCFB, #182823)"
  glass: "light-dark(rgb(250 252 251 / 0.78), rgb(24 40 35 / 0.78))"
  glass-strong: "light-dark(rgb(250 252 251 / 0.92), rgb(24 40 35 / 0.94))"
  ink: "light-dark(#15332E, #F3F8F6)"
  muted: "light-dark(#58716B, #9CB2AC)"
  divider: "light-dark(#C9DAD5, #2A423C)"
  divider-strong: "light-dark(#AFC7C0, #3C5A52)"
  navigation: "light-dark(#E7F0ED, #172923)"
  navigation-deep: "light-dark(#15332E, #09110F)"
  on-navigation: "light-dark(#15332E, #F3F8F6)"
  action: "light-dark(#125447, #68C7B0)"
  action-hover: "light-dark(#0D4137, #8AD8C5)"
  action-fill: "light-dark(#1E7666, #2A927E)"
  on-action: "light-dark(#F7FCFA, #07120F)"
  annotation: "light-dark(#356D85, #7AB9D3)"
  annotation-strong: "light-dark(#29566A, #A0D0E2)"
  annotation-fill: "light-dark(#477F97, #5B9DB8)"
  next-action: "light-dark(#995D08, #F3C56E)"
  next-action-fill: "light-dark(#D99724, #DFA54A)"
  next-action-hover: "light-dark(#BF7B16, #EDBC62)"
  on-next-action: "light-dark(#2A1B04, #231604)"
  success: "light-dark(#2F7657, #76CFA5)"
  success-fill: "light-dark(#3F936D, #4DAE81)"
  warning: "light-dark(#995D08, #F3C56E)"
  warning-fill: "light-dark(#D99724, #DFA54A)"
  danger: "light-dark(#A64139, #F28A80)"
  danger-fill: "light-dark(#C75A50, #D86C62)"
  on-danger: "light-dark(#FFF8F7, #1D0705)"
  spruce-annotation: "light-dark(#176B5B, #68C7B0)"
  spruce-action: "light-dark(#125447, #8AD8C5)"
  spruce-fill: "light-dark(#1E7666, #2A927E)"
  clay-annotation: "light-dark(#96513E, #E9A08A)"
  clay-action: "light-dark(#743D2F, #F0B6A5)"
  clay-fill: "light-dark(#A95F49, #C97C65)"
  moss-annotation: "light-dark(#557A43, #9BCB82)"
  moss-action: "light-dark(#3F5E32, #B5DEA0)"
  moss-fill: "light-dark(#668E50, #79A962)"
  pencil-blue-annotation: "light-dark(#356D85, #7AB9D3)"
  pencil-blue-action: "light-dark(#29566A, #A0D0E2)"
  pencil-blue-fill: "light-dark(#477F97, #5B9DB8)"
  iris-annotation: "light-dark(#66568E, #B5A4DE)"
  iris-action: "light-dark(#4D416D, #CFC3EB)"
  iris-fill: "light-dark(#7868A2, #9281BD)"
typography:
  display:
    fontFamily: "ui-rounded, SF Pro Rounded, Arial Rounded MT Bold, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.025em"
  hero:
    fontFamily: "ui-rounded, SF Pro Rounded, Arial Rounded MT Bold, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.55rem, 5vw, 2.35rem)"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "ui-rounded, SF Pro Rounded, Arial Rounded MT Bold, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.22rem"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-rounded, SF Pro Rounded, Arial Rounded MT Bold, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 720
    lineHeight: 1.16
    letterSpacing: "-0.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  supporting:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  action:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 680
    lineHeight: 1.1
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.76rem"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "0.015em"
rounded:
  compact: "10px"
  default: "14px"
  hero: "24px"
  capsule: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "28px"
  space-7: "36px"
  space-8: "48px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.action}"
    rounded: "{rounded.default}"
    padding: "10px 15px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.on-action}"
  button-next:
    backgroundColor: "{colors.next-action-fill}"
    textColor: "{colors.on-next-action}"
    typography: "{typography.action}"
    rounded: "{rounded.default}"
    padding: "10px 15px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.recessed}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.default}"
    padding: "10px 15px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.action}"
    typography: "{typography.action}"
    rounded: "{rounded.default}"
    padding: "10px 15px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    typography: "{typography.action}"
    rounded: "{rounded.default}"
    padding: "10px 15px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    padding: "10px 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
  status-capsule:
    backgroundColor: "{colors.recessed}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.capsule}"
    padding: "5px 10px"
    height: "30px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.supporting}"
    rounded: "{rounded.default}"
    padding: "10px 12px"
    height: "46px"
  active-project:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.hero}"
---

# Design System: Workshop

## Overview

**Creative North Star: "The Living Plan Table"**

Workshop is a cool, adaptive drafting surface for a real woodworking record. The active project's plan or photograph establishes context; a translucent tracing layer places its next useful move on top; search, filters, and the remaining library follow. Cool vellum, spruce structure, pencil-blue drafting marks, restrained amber, and a functional 24px plan grid create the shared language.

This is an Operate system and the web is the interaction authority. Semantic landmarks, links, durable routes, browser history, native form behavior, keyboard focus, hover as enhancement, and responsive web navigation take precedence over simulating iOS chrome or gestures. The iOS artifact confirms the shared material language, but `src/index.css` and the shipped React components own web values and behavior. Direction lineage: seed `ef48c050`.

The signed-out surface is the Persuade edge of the same world rather than a separate identity. Its sticky glass header, oversized rounded headline, plan drawing, tracing sheet, workflow rows, connected-tool list, and deep-spruce closing panel explain the product with the same vellum, grid, annotation, amber-next-action, and browser-native rules. Microsoft redirect failure is an inline danger message; the read-only demo is a first-class alternate entry rather than a signup route.

The former **Concourse Board** is retired. Condensed board lettering, split-flap seams, steel rails, rivets, tiny radii, and aggregate metric walls have no authority even where compatibility aliases or stale comments retain old names.

**Key Characteristics:**

- Cool adaptive vellum surfaces with deep spruce structural ink.
- A 24px drafting grid used as a functional plan surface, not generic page decoration.
- System UI type for reading and controls; an SF Rounded-like system stack for focal titles and compact data.
- A 14px default radius, 10px compact wells, 24px hero layers, and capsules only for compact state.
- Functional glass for shell/navigation, sticky tools and selection, and the active tracing layer.
- One active project and one amber next action lead before search and library content.
- Signed-out persuasion, authenticated operation, loading, empty, conflict, and fatal states share one token system.
- Light, dark, reduced-motion, reduced-transparency, forced-colors, touch, and print behavior are part of the system.

**The Shipped Artifact Rule.** Compatibility aliases and old component vocabulary carry no visual authority. They must resolve to the current semantic system; in particular, the legacy `--color-steel` alias resolves to `--color-action` so preserved Layer 1 controls retain contrast. New work consumes semantic tokens directly.

## Colors

The palette is semantic and adaptive: light and dark values are paired by role, while user settings may replace only the annotation axis.

### Primary

- **Deep Spruce Structure:** `action`, `action-hover`, `action-fill`, and their on-color carry primary navigation, ordinary primary actions, selected destinations, and structural emphasis.
- **Adaptive Annotation:** `annotation`, `annotation-strong`, and `annotation-fill` carry links, focus, selected filters, counts, and progress. The stylesheet fallback is Pencil Blue; `SettingsContext` reapplies the saved preset after hydration and whenever `data-theme` changes.

### Secondary

- **Pencil Blue:** `pencil-blue-*` is the drafting-note family and the fixed browser selection color. It is also the pre-provider fallback for the annotation custom properties.
- **Annotation Presets:** Spruce, Clay, Moss, Pencil Blue, and Iris each provide annotation, action, and fill values. The persisted default key remains the legacy string `amber`, but its shipped label and values are Spruce.

### Tertiary

- **Restrained Amber:** `next-action`, `next-action-fill`, and `next-action-hover` belong to the active project's single next-action control. `warning` deliberately shares the same literal family but remains a separate semantic role.
- **Success / Warning / Danger:** State always combines color with text, iconography, or control semantics. Success, warning, and danger do not inherit the user-selectable annotation preset.

### Neutral

- **Cool Vellum Canvas:** `canvas` is the page ground; `recessed` forms wells and quiet selected areas; `surface` is the opaque raised sheet.
- **Functional Glass:** `glass` and `glass-strong` are translucent variants of the raised sheet, not general-purpose card fills.
- **Ink and Dividers:** `ink` is primary content; `muted` is secondary explanation; `divider` and `divider-strong` provide adaptive 1px structure.
- **Navigation Material:** `navigation`, `navigation-deep`, and `on-navigation` support persistent shell chrome and the hammer mark.

`@theme` exposes the core roles to Tailwind, but the complete runtime source is the semantic custom-property set on `:root` and `:root[data-theme="dark"]`. The old `concourse`, `flap`, `steel`, and `amber` custom properties are migration aliases only. `--color-steel` deliberately resolves to `--color-action` so preserved Layer 1 checkboxes, selected controls, and Shaper identifiers remain contrast-safe until migration; this alias does not reinstate steel as a material or semantic role.

### Named Rules

**The Semantic Role Rule.** Components consume semantic custom properties; they do not embed a light-only hex or infer meaning from a compatibility token's old name.

**The Amber Next Action Rule.** Amber marks the active project's next useful move and warning state. It is not the primary brand wash, navigation accent, or general annotation color.

**The Adaptive Annotation Rule.** A preset may replace annotation, annotation-strong, and annotation-fill together; it may not recolor vellum, fixed spruce structure, amber next action, success, or danger.

## Typography

**Display Font:** `ui-rounded`, SF Pro Rounded, Arial Rounded MT Bold, then the system UI stack

**Body Font:** `-apple-system`, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif

**Label/Mono Font:** The same system stacks; numeric readouts use tabular figures rather than a separate mono face

**Character:** Rounded system type makes project names, section headings, values, and focal actions approachable without reviving a branded display face. Default system UI keeps prose, forms, navigation, and controls familiar and browser-native.

### Hierarchy

- **Display** (700, `clamp(1.7rem, 4vw, 2.25rem)`, 1.16): Route titles; the inherited heading tracking is `-0.025em`.
- **Hero** (700, `clamp(1.55rem, 5vw, 2.35rem)`, 1.16): The active project title over media.
- **Headline** (700, `1.22rem`, 1.16): The next useful action inside the tracing layer.
- **Title / Rail** (720, `1rem`, compact leading): Section rails and card titles; rails tighten tracking to `-0.015em`.
- **Body** (400, `1rem`, 1.5): Default reading and native controls. Long copy is constrained with 68–70ch measures.
- **Supporting** (400–650, `0.82–0.92rem`, usually 1.5): Page descriptions, status copy, card summaries, command items, form hints, and active-layer explanation. Notebook snippets use `0.84rem`; general supporting copy uses `0.88rem`; route subtitles reach `0.92rem`.
- **Label** (650–700, `0.62–0.78rem`): Metadata, status, filters, table heads, mobile navigation, stage names, and upload percentages. The shared label class is `0.76rem` with `0.015em` tracking; `0.68–0.72rem` is reserved for dense swatches, statuses, and navigation.
- **Readout:** Rounded system type with `font-variant-numeric: tabular-nums`; shipped card values are `0.78rem`, active metadata is `0.9rem`, and larger statistics reach `1.25rem`.
- **Signed-out Hero** (700, `clamp(2.35rem, 7vw, 4.8rem)`, 0.98): The landing proposition only; below 620px it uses `clamp(2.3rem, 13vw, 3.35rem)`.
- **Editor Source** (400, `0.9rem`, 1.65): The sole monospace exception for Markdown and code, using the native `ui-monospace` stack.

The root remains `1rem` (16px at browser default). The large-text setting raises the root to `106.25%`, allowing rem-based sizes to scale together.

### Named Rules

**The System Pairing Rule.** Use the rounded stack for focal names, rails, and compact data; use the default system stack for reading, forms, and browser controls.

**The No Board Face Rule.** Do not restore Martian Mono, condensed widths, all-caps board lettering, split-flap readouts, or a third display family.

**The Tabular Data Rule.** Measurements, quantities, hours, and money use tabular figures without changing the surrounding text to monospace.

## Layout

The app sits on a fixed, inaccessible plan field: a cool diagonal vellum gradient plus an orthogonal 24px grid that fades toward the bottom. The grid repeats inside the no-photo active-plan fallback. This detector-visible grid is intentional drafting infrastructure; do not suppress it as generic background decoration.

The primary page column is `min(100%, 1200px)`, centered with 16px mobile insets and `28px 16px 72px` padding. At desktop it becomes `38px 32px 80px`; detail routes cap at 900px. The default spacing scale is 4, 8, 12, 16, 20, 28, 36, and 48px, with 16px library gaps and 28–46px separation between major groups.

The active project is the first substantial layer after the page switcher. Below a 680px page container it stacks a minimum 270px photo/plan over the next-action sheet. At 680px and above it becomes a two-column layer with a minimum 430px hero; the action sheet occupies at least 300px / 38%, overlaps the media by 34px, and keeps a 24px inset. Library cards use an adaptive 280px minimum; templates use 240px.

Mobile uses a fixed utility header (`60px` plus top safe area), five-destination bottom navigation (`66px` plus bottom safe area), 44px icon controls, and content clearance of 64px above and 72px below. At 768px the compact shell becomes a persistent 256px sidebar; at 1040px it widens to 272px. A 420px breakpoint reduces page insets to 12px. Container thresholds at 620px and 680px adapt tools and the active project without tying layout to device orientation.

The 768px shell breakpoint and the page container thresholds solve different problems. At an 820px viewport the sidebar is correctly present, but the remaining content column is only about 564px before page insets; dashboard tools therefore stay stacked and the active-project layer stays single-column. They expand only when the named page container itself reaches 620px and 680px. Do not replace these container queries with viewport queries.

Remaining route-specific thresholds are evidence-based: the landing hero becomes two columns at 860px; conversion inputs, paired inch tables, and Settings rows become two columns at 900px; conversion results stack and reference tabs scroll below 760px; narrow editor/actions collapse at 520px; shopping summaries and rows reorganize below 560px; project and Shaper detail heroes become two columns at 1040px; conversion reference controls stack below 1100px. Fractional conversion tables keep a 960px intrinsic width inside a focusable horizontal scroller.

**The Active Layer Rule.** The active project and next useful move lead. Search, filters, aggregate counts, templates, and inspiration follow rather than competing above it.

**The Browser Shell Rule.** Use semantic links, buttons, landmarks, routes, browser history, and safe-area-aware responsive navigation. Share visual language with iOS without copying native bars, gestures, or navigation behavior.

**The Touch-First Control Rule.** Interactive targets remain at least 44×44px; horizontal filter and table overflow scrolls rather than shrinking controls below that floor.

**The Content-Width Rule.** Shell changes follow the viewport; dense content changes follow its available column. An 820px viewport is not permission to force a desktop content composition beside the sidebar.

## Elevation & Depth

Depth is a restrained hybrid of tonal layering, 1px adaptive borders, soft vertical shadows, and blur only where a translucent layer has a functional reason to exist.

### Shadow Vocabulary

- **Library Sheet:** `0 7px 14px rgb(21 51 46 / 0.1)` in light and `0 7px 14px rgb(0 0 0 / 0.28)` in dark.
- **Library Sheet Hover / Hero:** `0 10px 22px rgb(21 51 46 / 0.14)` in light and `0 10px 22px rgb(0 0 0 / 0.38)` in dark; hover also lifts by 2px only on hover-capable devices.
- **Tracing Layer:** `0 8px 16px rgb(21 51 46 / 0.12)` in light and `0 8px 16px rgb(0 0 0 / 0.3)` in dark.
- **Sidebar Rail:** `0 8px 18px rgb(21 51 46 / 0.12)` in light and `0 8px 18px rgb(0 0 0 / 0.34)` in dark.
- **Command Dialog:** `0 24px 70px rgb(5 17 14 / 0.3)` marks the modal layer.
- **Visible Focus:** A 3px annotation outline with 3px offset plus `0 0 0 3px rgb(71 127 151 / 0.34)`.

When backdrop filters are supported, shell chrome and the active tracing layer use `blur(20px) saturate(1.08)`. The command backdrop alone uses 4px blur. Reduced Transparency replaces both glass roles with opaque `surface` and removes backdrop filters.

### Named Rules

**The Functional Glass Rule.** Blur belongs to persistent shell/navigation, sticky tool or selection chrome, the active tracing sheet, and modal separation. Ordinary cards remain opaque raised sheets.

**The One Hero Rule.** Only the active project receives 24px clipping and hero depth. Ordinary project and template cards use the 14px default.

**The Hover Is Additive Rule.** Lift and hover tint may reward a pointer, but visibility, state, and required actions remain complete without hover.

## Shapes

The system uses soft browser geometry: 10px for compact icon wells and inner selections, 14px for ordinary controls and cards, and 24px for the singular active-project layer and command dialog. Compact state is allowed to use a 999px capsule because the pill communicates status or selection; capsules are not a general container shape.

Literal exceptions in the shipped CSS are functional and local: 3px active-navigation bars, 6px checkboxes and keyboard wells, a 7px command-key well, 9px lamp glass, and circles for the account avatar and stage nodes. These are not additional radius tokens.

Borders are normally 1px adaptive dividers. Images clip to their card or hero bounds; project photos use a 16:9 well and `object-fit: cover`.

**The Fourteen-Pixel Default Rule.** Begin an ordinary control, field, card, navigation destination, or grouped selection at 14px; depart only for a documented compact well, state capsule, circle, or singular hero.

**The State Capsule Rule.** A pill must carry compact state or selection. Do not use capsules as decorative wrappers for arbitrary copy or whole content regions.

## Components

### Buttons

- **Shape:** 14px radius, minimum 44px height, `10px 15px` padding, 680 weight, and a 0.97 pressed scale with reduced opacity.
- **Primary:** Fixed spruce `action` with `on-action` text for ordinary creation and confirmation.
- **Next:** Amber fill spans the tracing layer and is reserved for the active project's next action.
- **Secondary / Ghost:** Recessed secondary controls keep a divider border; ghost controls remain transparent with spruce text.
- **Danger:** Semantic danger fill and paired on-danger text; never inherit the annotation preset.
- **Hover / Focus:** Hover changes only on hover-capable devices. All variants retain the global 3px `:focus-visible` treatment.

### Chips

- **Status capsules:** 30px minimum height, `5px 10px` padding, 999px radius, and a text label. Idea is muted, planning is annotation, in-progress is amber, completed is success, and destructive/cancelled states are danger.
- **Selection controls:** Segmented and filter controls use a recessed 14px group with 10px inner selections and 44px buttons. `aria-pressed` carries state.

### Cards / Containers

- **Project card:** Opaque surface, 14px radius, 1px divider, image-forward 16:9 media, two-line description, and a divided metadata footer with tabular values.
- **Active project:** 24px clipped media/plan layer with a functional tracing sheet, stage track, parts/shop-time metadata, and full-width amber next-action button.
- **Board rows:** Open list rows remain at least 56px high with 1px dividers; the `rail` above them is an open rounded-system heading, not a steel band.
- **State panel:** A 14px dashed container with centered explanation; danger adds a light semantic tint and explanatory text.

### Inputs / Fields

- **Style:** Native input, textarea, and select behavior inside a 44px minimum, 14px surface field with `10px 12px` padding and a 1px divider.
- **Search:** A 48px field with a real label, leading search icon, 42px left padding, and strong glass only where it functions as toolbar/search chrome.
- **Focus:** Annotation border plus the shared focus ring. Textarea remains vertically resizable; checkbox keeps browser behavior and uses the action fill as `accent-color`.
- **Error / Disabled:** Errors use danger plus explanatory text. Disabled buttons retain labels and reduce opacity to 0.48.

### Core Workflows

- **Dashboard contexts:** Projects and Shaper Hub share `/` and a persisted segmented switcher, but keep independent search, counts, libraries, and state panels. Project status filters never appear in Shaper Hub. The Projects context places the focus project first, then the searchable/sortable library, live template clone/delete controls, external build-inspiration links, and the optional Shopkeep companion link. Templates and inspiration do not have standalone routes.
- **Project detail:** The plan/photo and tracing layer lead, followed by open rails, native tables, galleries, build and finish logs, project links, shopping evidence, template creation, and optimizer output. Inline deletion confirmation stays attached to its trigger; image and PDF previews use modal lightboxes with Escape, trapped focus, and focus restoration.
- **Forms:** Plan or Shaper import comes first, essentials precede advanced lists, and native fieldsets group photos, measured parts, materials, instructions, and save actions. Project editing gains a sticky save bar after the top actions scroll away. Existing project uploads expose per-file progress, completion, failure, and dismissal; new Shaper uploads queue until the project exists and report partial failures instead of implying an atomic save.
- **Shopping:** Acquisition rows stay grouped by project provenance, expose quantity and remaining cost, and use the whole label row as the completion target. Search, purchased visibility, optimistic individual and bulk completion, rollback errors, grouped project links, and the dedicated printable list are shipped behavior.
- **Cut plan:** Stock input, kerf, exact optimizer evidence, sheet figures, and exports use the same semantic palette. Part colors distinguish placement only; they never alter optimizer ordering or geometry.

### Conversion Tables

The quick calculator accepts one positive millimeter or inch value and presents millimeters to three decimals, decimal inches to five, and a nearest-1/32-inch fraction. Copy and reset are explicit, live status remains textual, and invalid/non-positive input shows the neutral placeholder. Three segmented reference modes are real views: 1–100mm, 1–96 whole inches in two 48-row tables, and eighth-inch increments through 48 inches. Tables retain native table semantics, tabular figures, alternating tonal rows, focusable horizontal overflow, and print-safe surfaces.

### Notebook

The list is a live signed-in view of the Tabloom notebook named “Workshop,” with loading skeletons, page snippets, relative edit times, missing-notebook guidance, retryable failures, and creation. Demo mode exposes a deliberate unavailable state and never requests a Tabloom token.

The editor is manual-save only. It defaults new pages to Edit and existing pages to Preview, exposes a title field plus Markdown source, renders GFM by passing Markdown through `marked` and then DOMPurify, supports ⌘S/Ctrl-S, and reports new, dirty, saving, saved, and relative-edited state in the sticky toolbar. The sanitizer preserves DOMPurify-safe Tabloom `data-*` attributes and safe `tabloom:` URI semantics through its explicit URI pattern while removing executable markup. The client edits and sends `body_md`; the Tabloom response also contains `html`, but the shipped Workshop preview is regenerated from Markdown rather than mounting that field. Tabloom-only source blocks therefore remain visible and round-trip unchanged. Preview/Edit are labelled tabs with labelled panels; only the selected tab is in the tab order, and ArrowLeft/ArrowRight/Home/End move selection and focus. Updates send the previous `edited_at` as `expected_edited_at`; a 409 offers “Reload latest” or “Overwrite with mine.” Dirty pages use the `createBrowserRouter` data-router blocker for in-app PUSH, REPLACE, and POP navigation even while a save is in flight, plus `beforeunload` for document exits. A successful new-page save updates the baseline so the editor is clean before its replace-history redirect to the created page.

### Settings

Settings are open grouped rows, not a card dashboard: Appearance (light/dark/system, five adaptive annotation presets, normal/large text), Project defaults (new-project status, dashboard sort, completed visibility), Data (a JSON project-list summary, explicitly not a full backup), Account (identity or demo mode, sign out/exit), a two-step signed-in delete-account danger zone, and the build version. Browser-local appearance/defaults are persisted independently of existing projects. Export status, deletion progress, and deletion failure remain inline and textual. Irreversible server-side account deletion is separate from ordinary remote logout: after deletion succeeds Workshop attempts the Microsoft logout redirect; if that redirect fails, it clears the active account and local MSAL cache before replacing the document to `/`.

### Global Route and Feedback Behavior

Before the application shell, `AuthGuard` admits the session-scoped demo, shows the signed-out landing page when no Microsoft account is authenticated, and shows a dedicated “Signing you in…” icon-and-skeleton state while MSAL handles a redirect or acquires a token. Startup and outer-render failures use the root boundary; authenticated route failures use the recoverable in-shell boundary.

Every implemented application route is lazy-loaded behind one shared `Suspense` workspace skeleton and a route-keyed `ErrorBoundary`; route changes set a specific document title. Grouped loading skeletons for project, shopping, and Notebook content are polite busy status regions with an accessible loading label while their visual placeholder shapes remain hidden from assistive technology. A `createBrowserRouter` wildcard root preserves the route table in `App.tsx` while enabling dirty-state blocking. The only routes are `/`, project new/detail/edit, Shaper new/detail/edit, `/conversions`, `/shopping-list`, `/notebook`, `/notebook/:id` (including `new`), and `/settings`. Unknown paths replace-history redirect to `/`. There are no standalone templates, inspiration, legal, help, about, or not-found screens.

The command palette and media previews are modal dialogs: background content becomes inert where applicable, Tab is contained, Escape closes, and focus returns. Sonner toasts are capped at four, closeable, token-colored, and bottom-right; use them for transient completion or blocked-demo feedback while persistent load/save/conflict failures remain inline. Demo mode is session-scoped, shows a global read-only banner, permits reads against seeded data, blocks writes before the network, throttles blocked-action toasts, and replaces Notebook with signed-in guidance.

### Navigation

- **Wide shell:** A 256–272px frosted sidebar with 46px destinations, 14px radius, icons plus labels, persistent create actions, search shortcut, theme control, and account actions.
- **Compact shell:** A frosted top utility bar and safe-area bottom navigation. Five labeled destinations stay visible; current state uses spruce text, a faint fill, `aria-current`, and a 3px marker.
- **Keyboard:** Skip link, command palette, native links, visible focus, and durable routes are mandatory browser behavior.

### Shared Primitives

`Button`, `IconButton`, `PageFrame`, `PageHeader`, `SectionRail`, `SegmentedControl`, and `StatePanel` in `src/components/ui.tsx` are the shared React primitives. `CreateProjectMenu`, `WorkflowSection`, `FormSection`, and `Field` in `src/components/workflows.tsx` carry the shared Layer 2 interaction patterns. `AppShell` owns the responsive shell; `ProjectCard`, `ShaperProjectCard`, and `StatusBadge` own library and semantic-state patterns; the dashboard composes the active project without inventing a second navigation model.

Theme and settings persistence are part of the visual contract. The pre-paint script and `ThemeContext` read `workshop-theme`, accept only `light`, `dark`, or `system`, fall invalid values back to `system`, follow OS changes while in system mode, and write the resolved rendition to `data-theme`. `SettingsContext` reads `workshop-settings`, shallow-merges current defaults, replaces retired or unknown accent names with the legacy `amber` key that now means Spruce, reapplies the three annotation custom properties after every rendition change, and scales the root to `106.25%` for large text. The preset labels are Spruce, Clay, Moss, Pencil Blue, and Iris; each swaps annotation ink, strong ink, and fill as a light/dark family.

Motion uses 140ms for direct state change and 200ms for card/elevation change with `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced Motion collapses animation and transition durations to `0.01ms` and replaces the moving skeleton with a static recessed fill.

Forced Colors maps semantic roles to system colors, hides the drafting grid, and lets native controls adjust. Print forces a white/light palette, removes shell chrome, field background, switcher, actions, and buttons, expands content to full width, removes card shadows, and avoids breaking cards/boards across pages.

## Do's and Don'ts

### Do:

- **Do** use the semantic light/dark custom properties and keep the runtime annotation preset adaptive.
- **Do** keep the active plan/photo and next-action tracing layer dominant before search and library content.
- **Do** treat the 24px drafting grid as functional plan infrastructure and hide it from accessibility and forced-color output.
- **Do** use the system rounded stack for focal names and compact data, and the default system stack for reading and controls.
- **Do** preserve 10px compact, 14px default, 24px hero, 44px targets, and state-only capsules.
- **Do** keep glass functional and provide the shipped reduced-transparency fallback.
- **Do** preserve native fields, durable links/routes, visible focus, safe areas, and print behavior.
- **Do** keep hover enhancements behind hover-capability queries and give every motion a reduced-motion outcome.
- **Do** keep route chunks lazy, route titles specific, grouped loading skeletons exposed as polite busy status regions, and unexpected route failures recoverable without inventing a not-found surface.
- **Do** preserve content-width container queries; verify the sidebar-plus-stacked-content composition at 820px.
- **Do** keep Notebook saves manual, sanitize GFM after `marked`, preserve safe Tabloom semantics, guard dirty in-app and document exits, and make Tabloom conflicts explicit.

### Don't:

- **Don't** revive the retired Concourse Board metaphor, Martian Mono, condensed board lettering, split-flap seams, steel bands, rivets, tiny radii, or summary-metric walls.
- **Don't** use amber as the primary brand/action wash; it belongs to the next useful move and warning semantics.
- **Don't** let a user annotation preset recolor vellum, fixed spruce structure, success, warning, or danger.
- **Don't** place ornamental glass behind ordinary content or stack blur layers without a shell, tool, selection, tracing, or modal purpose.
- **Don't** use hover to reveal a required action or state.
- **Don't** hardcode a light-only color in a component when a semantic custom property exists.
- **Don't** simulate iOS chrome, gestures, sheets, or navigation on the web.
- **Don't** treat legacy `flap`, `steel`, `amber`, departure-card comments, or other migration names as permission to restore the old visual world.
- **Don't** invent standalone templates, inspiration, legal, help, about, or not-found routes; the catch-all redirects to `/`.
- **Don't** canonize the pre-React emergency startup panel's hardcoded monospace, uppercase, and red styling; it is last-resort failure output, not the house system.
