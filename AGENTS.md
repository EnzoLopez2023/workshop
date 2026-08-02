# AGENTS.md — Workshop

Woodworking project planner: React/Vite web client on an Azure App Service API with Entra auth and per-user SQLite.

## Start here
- **Repo detail / architecture:** see [CLAUDE.md](CLAUDE.md)
- **Cross-app standards:** https://github.com/EnzoLopez2023/azure-infra/blob/main/STANDARDS.md
- **Cross-repo product map:** https://github.com/EnzoLopez2023/azure-infra/blob/main/PORTFOLIO.md

> Agent sessions run in git worktrees, so relative paths into sibling repos (`../foo/BAR.md`) do **not** resolve. The cross-repo facts below are inlined deliberately. Always link other repos by absolute GitHub URL.

## Related surfaces

### [Workshop-for-iOS](https://github.com/EnzoLopez2023/Workshop-for-iOS) — native SwiftUI Workshop
**PORT on a shared Azure backend.**

- Same Entra registration, same server, full **bidirectional CRUD**.
- 10 of the 12 web routes are implemented on iOS. The **Notebook** route (Tabloom integration) is **deferred to v2**.

### [NintekKit](https://github.com/EnzoLopez2023/NintekKit) — shared Swift package
Holds the Swift side of the duplicated cut-plan optimiser (`CutPlan.swift`).

## Propagation rule

**BACKEND + ALGORITHM PARITY.**

1. **API / schema changes go to both clients.** The backend is shared; a one-sided change breaks iOS silently.
2. **The cut-plan optimiser is DUPLICATED.** `src/lib/cutPlan.ts` in this repo mirrors `CutPlan.swift` in NintekKit — including `parseInches` fraction parsing — and the two are **unit-tested against each other so layouts match exactly**.

   **Change one, change the other, re-run the parity tests.** A cut-plan edit landed on only one side is a bug, not a partial feature.
