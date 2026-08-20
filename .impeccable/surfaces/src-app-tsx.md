---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/AppShell.tsx","src/pages/Dashboard.tsx"]
---

## Scope and mode

- **Scope:** The authenticated React application shell in `src/App.tsx`, its responsive navigation,
  the root Projects/Shaper Hub surface, and the shared primitives later feature layers inherit.
- **Mode:** Operate.

## Audience, job, and task

- A hobbyist woodworker plans at a desk, then checks plans, cuts, and shopping details on a phone
  in the shop.
- The shell must make the active project and its next useful move immediate while keeping every
  existing web destination, deep link, and command-palette route stable.
- Demo visitors use the same shell in an explicit read-only state.

## Content and constraints

- Preserve React Router URLs, MSAL/AuthGuard bootstrap, browser history, command palette, theme and
  settings storage keys, demo behavior, Notebook, Shopping List, Conversion Tables, Settings,
  regular projects, and Shaper Hub projects.
- Use a persistent 240–280px frosted sidebar from tablet width upward and a compact top utility bar
  plus safe-area bottom navigation on phones.
- Translate iOS material and geometry into semantic HTML, links, native form controls, visible
  focus, 44px targets, and reduced-motion/transparency/forced-colors/print media behavior.
- Keep backend, schema, authentication contracts, and cut-plan logic untouched.

## Chosen direction and memorable moment

- **Living Plan Table:** cool adaptive vellum canvas, deep spruce structural ink, pencil annotation,
  restrained amber for the single next action, a 24px plan grid, 14px default geometry, and a
  24px active-project layer.
- The memorable moment is the active project: its plan or photo sits beneath a functional tracing
  sheet that names the next action, stage, parts, and shop time before the library begins.

## Unresolved decisions

- Feature-page composition beyond compatibility styling belongs to later redesign layers.
- The signed-out marketing surface keeps its current information architecture until its own layer.
