---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/AppShell.tsx","src/pages/Dashboard.tsx"]
---

## Scope and mode

- **Scope:** The complete React application shell in `src/App.tsx`, signed-out landing and auth
  states, responsive navigation, every registered route, and the global states shared by them.
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
- Registered feature routes are Projects/Shaper CRUD, Shopping List, Conversion Tables, Notebook
  list/detail/new, Settings, and the root Projects/Shaper dashboard. The catch-all redirects to `/`;
  no standalone legal, help, template, inspiration, admin, insight, unauthorized, or not-found
  surface exists.

## Chosen direction and memorable moment

- **Living Plan Table:** cool adaptive vellum canvas, deep spruce structural ink, pencil annotation,
  restrained amber for the single next action, a 24px plan grid, 14px default geometry, and a
  24px active-project layer.
- The memorable moment is the active project: its plan or photo sits beneath a functional tracing
  sheet that names the next action, stage, parts, and shop time before the library begins.

## Unresolved decisions

- None for the shipped web system. Future routes must extend the same browser-native shell and
  Living Plan Table primitives rather than introducing a parallel visual dialect.
