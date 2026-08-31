# AGENTS.md — Workshop

Canonical woodworking project planner: React/Vite web client on an Azure App Service API with Entra auth and per-user SQLite.

## Start here
- **Repo detail / architecture:** see [CLAUDE.md](CLAUDE.md)
- **Cross-app standards:** https://github.com/EnzoLopez2023/azure-infra/blob/main/STANDARDS.md
- **Cross-repo product map:** https://github.com/EnzoLopez2023/azure-infra/blob/main/PORTFOLIO.md

> Agent sessions run in git worktrees, so relative paths into sibling repos (`../foo/BAR.md`) do **not** resolve. The cross-repo facts below are inlined deliberately. Always link other repos by absolute GitHub URL.

## Supported client and retired surfaces

**Workshop web is the only canonical supported client** and remains live at
<https://workshop.nintek.com>.

### [Workshop-for-iOS](https://github.com/EnzoLopez2023/Workshop-for-iOS) — historical native SwiftUI client

Workshop-for-iOS was a sole-user, TestFlight-only port on the shared Azure backend; it was
never publicly released. It is archived/read-only at retirement main SHA
`bcf46a91cdbc95b2b1c0e4a5c585c76369051828`. The final functional source was
`5be546524e79b9c63b2a4effb5ec24e03fe6d777`, version 2.3.0 (15). All 16 TestFlight builds
are expired, the beta group is deleted, and there is no public listing or current submission.

Historically, the client shared the web app's Entra registration and backend and implemented
10 of the then-12 web routes; Notebook was deferred. This is historical context, not an active
product or parity commitment.

### [NintekKit](https://github.com/EnzoLopez2023/NintekKit) — frozen public compatibility

NintekKit retains its `WorkshopAPI`, models, and `CutPlan.swift` as frozen public
compatibility surfaces. They are no longer active Workshop parity targets.

## Contribution rules

1. Make supported client changes in this repository. Do not attempt to propagate web API,
   schema, backend, UI, or model changes to the archived iOS repository.
2. The web cut-plan implementation in `src/lib/cutPlan.ts` may evolve as web product code.
   Do not change NintekKit solely to preserve retired Workshop iOS parity.
3. **iOS retirement changes no shared backend behavior and does not authorize account
   compatibility removal.** Until a separately approved phase, preserve dormant Apple
   authentication, Apple refresh-token storage/revocation, provider-scoped Apple database
   compatibility, account deletion, and access to historical accounts.
