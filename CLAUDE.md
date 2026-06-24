# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Cross-app standards** (versioning, Key Vault/secrets, deploy/CI, auth, iOS readiness, Azure registry) are defined in the canonical [azure-infra/STANDARDS.md](../azure-infra/STANDARDS.md). Consult it first; it wins over this file for shared conventions.

## Deploy reality (READ FIRST)

Production runs on **Azure App Service (Linux container)** — not Docker on a self-hosted box, not IIS.

- Resource: `app-workshop-prod-lwxhu7jxlrbtu` in resource group `rg-personal-apps-prod`
- Image: `acrenzolopez01.azurecr.io/workshop:latest` (pulled by App Service on restart)
- Public URL: <https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net>
- Verify: `curl https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net/api/health` → `{"status":"ok","db":"/home/data/workshop.db"}`
- Backend env vars (`AZURE_TENANT_ID`, `API_AUDIENCE`, `ALLOWED_OID`, `ANTHROPIC_API_KEY`, `DB_PATH=/home/data/workshop.db`, `UPLOADS_PATH=/home/data/uploads`) live in **App Service → Configuration**, not in any committed file.
- SQLite + uploads persist on the App Service mounted storage at `/home/data` (note: `Dockerfile` declares `VOLUME /data`, but App Service overrides the mount point).

**Deploy pipeline.** `.github/workflows/deploy.yml` is the live prod pipeline: every push to `main` (except `**/*.md`, `azure-infra/**`, `.gitignore` — see `paths-ignore`) runs on `ubuntu-latest`, OIDC-logs into Azure, runs `az acr build` to build the image server-side in ACR with `VITE_AZURE_CLIENT_ID`/`VITE_AZURE_TENANT_ID` baked in, restarts the web app, and polls `/api/health` for up to 5 minutes (B1 cold start is 2-4 min). The Vite IDs live as plain env entries in `deploy.yml` — they are not secrets. To deploy without code changes (e.g. after a config change), use `workflow_dispatch`.

## Stale docs / retired paths — do NOT follow these without asking

| File | What it claims | Reality |
|---|---|---|
| `README.md` § Docker deployment | `deploy.ps1` ships the app | `deploy.ps1` only builds + runs locally. Prod ships via the GH Actions workflow above. |
| `deploy.ps1` | The deploy script | Local dev convenience only. Hits `http://localhost:3006/api/health`. |
| `iis-setup.ps1` + `public/web.config` | IIS reverse-proxy setup with HTTPS redirect | Old on-prem deploy path. Linux App Service serves the SPA via Express `express.static('dist')` — `web.config` is unused in prod (Linux containers ignore it). |
| README "Deployment" table | Lists only `local dev` and `Docker` | Missing the actual prod path (Azure App Service + GH Actions). |
| Comments in `Dockerfile` and `deploy.yml` referencing `AZURE_ARCHITECTURE.md` and `MIGRATION_RCA.md` (#3, #4, #9) | External docs explain quirks | **These files are not in the repo and not in history.** They appear to be private notes. Don't grep for them or assume context — work from the code. |
| `azure-infra/**` in workflow `paths-ignore` | Directory exists | Not in the repo — likely gitignored or planned. The workflow filter is forward-looking. |

## Stale-looking names (DO NOT "fix" these without asking)

| Identifier | Why it looks odd | Truth |
|---|---|---|
| `API_AUDIENCE` (backend) vs `VITE_AZURE_CLIENT_ID` (frontend) | Two names | Both hold the same Azure AD App Registration client id. Keep both — backend validates JWT audience, frontend uses it as the MSAL `clientId`. |
| `app-workshop-prod-lwxhu7jxlrbtu` | Random suffix | Azure-assigned uniqueness suffix on the App Service name. Not a typo. |
| `acrenzolopez01` (registry) vs `enlo@microsoft.com` / `enzolopez@hotmail.com` (accounts) | Inconsistent personal handles | All belong to the same owner. Leave alone. |
| `VOLUME ["/data"]` in `Dockerfile` vs `/home/data/...` in prod env | Mismatch | App Service ignores Docker volumes and mounts its own persistent storage at `/home`. Both Dockerfile defaults (`/data/...`) and Azure overrides (`/home/data/...`) are correct in their respective contexts. |
| OIDC service-principal IDs `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID` in `deploy.yml` env | Look like secrets | Not secrets. The federated credential scopes them to this repo + branch. Safe to commit; do not move them into GitHub Secrets. |

## Architecture in 60 seconds

- **Frontend.** React 19 + Vite 8 + Tailwind v4 + React Router v7. The whole route table is in `src/App.tsx` — adding a view = add a page in `src/pages/`, add a `<Route>`. `src/main.tsx` initializes MSAL **before** rendering and registers the instance with `services/api.ts` via `setMsalInstance()`; without that step, every API call ships without a token.
- **State.** No store. Each page fetches its own data via `src/services/api.ts` (typed `fetch` wrappers). All types live in `src/types/project.ts`.
- **Backend.** Single file: `server.js` (~1500 lines). Order is: schema (`CREATE TABLE IF NOT EXISTS`) → additive migrations (`ALTER TABLE ADD COLUMN` guarded by `PRAGMA table_info`) → `stmts` object of prepared statements → helpers → auth middleware → routes → `app.listen`.
- **Auth.** Azure AD JWT validated against the tenant's JWKS (`jose`). `app.use('/api', ...)` gates everything except `/api/health`, `/api/images/:id`, and `/api/build-log/:id/image` — these last two are exempt because `<img>` tags can't send `Authorization` headers. Optional `ALLOWED_OID` further restricts to a single user.
- **Adding a new endpoint.** Prepared statement in `stmts` → handler in `server.js` matching neighbouring patterns → typed wrapper in `src/services/api.ts` → type in `src/types/project.ts`.

## Active work — invariants to preserve

- **Notebook feature** (`src/pages/NotebookList.tsx`, `src/pages/NotebookPage.tsx`, routes `/notebook`, `/notebook/:id`, `/notebook/new`). The notebook UI is an **editable window onto Tabloom** — there are no local `notebook_pages` tables in Workshop. Pages are fetched, updated, and created via Tabloom's `/api/integrations/workshop/*` endpoints in `src/services/tabloomApi.ts`. The wire format is plain Markdown (`body_md`); Tabloom converts to/from its canonical ProseMirror store. Tabloom-only blocks (callouts, figures with mediaId, inline tags) round-trip via raw HTML / `tabloom://tag/` Markdown links — visible in source, preserved on save, but not editable in Workshop's textarea. The token is a Tabloom-scoped access token obtained by `src/auth/getTabloomToken.ts`. Concurrency is optimistic: `updateTabloomWorkshopPage` sends `expected_edited_at` and returns `{ ok: false, reason: 'conflict', current }` on 409 so `NotebookPage.tsx` can show a Reload / Overwrite prompt. Preview tab renders Markdown via `marked` and re-uses `src/styles/tabloom-content.css` for fidelity with Tabloom's own export.
- **Tabloom integration auth flow** — `src/auth/getTabloomToken.ts` acquires an AAD **access token** (not an ID token) with scope `api://<TABLOOM_CLIENT_ID>/access_as_user`. **Azure AD prerequisites:** Tabloom's app registration must expose the `access_as_user` scope, and Workshop's app registration must have that delegated permission granted + admin-consented. If this breaks with 401, check Tabloom's `requireAuth` — it must accept `api://` audience format and the v1 STS issuer (`sts.windows.net`).
- **Vite build-time env var pipeline** (`Dockerfile` lines 16-25, `docker-compose.yml` `build.args`, `deploy.yml` env + `--build-arg`). `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_TABLOOM_API_BASE_URL`, and `VITE_TABLOOM_CLIENT_ID` are **baked into the JS bundle at `npm run build`** — they must be passed as Docker `--build-arg`s, not as App Service runtime app settings. Forgetting this ships a bundle that throws at startup. The prod values live as env entries at the top of `deploy.yml`.
- **`cut_list_items` table.** Either `project_id` or `shaper_project_id` is set, never both — enforced by a `CHECK` constraint. The migration that adds this (`server.js` ~140-187) recreates the table; it must run with `foreign_keys = OFF` and restore to ON in a `finally` block.

## How to verify changes

| Goal | Command |
|---|---|
| Type-check (frontend + shared types) | `npx tsc -b` — there is **no** `npm run typecheck` alias |
| Production build (also type-checks) | `npm run build` |
| Run locally (two terminals) | `npm run server` then `npm run dev` (Vite proxies `/api` → `:3006`) |
| Tests | None exist. Don't claim "all tests pass" — there are no tests. |
| Lint | No linter configured. |
| Hit deployed health | `curl https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net/api/health` |
| App Service logs | `az webapp log tail -n app-workshop-prod-lwxhu7jxlrbtu -g rg-personal-apps-prod` |
| Trigger a deploy without a code change | GH UI → Actions → "Build & Deploy Workshop to Azure" → Run workflow, or push a commit that touches a non-ignored path |

TypeScript runs with `strict`, `noUnusedLocals`, `noUnusedParameters` — unused imports/params fail the build.

## Tabloom integration

Workshop's notebook view pulls from Tabloom's read-only integration API. Key files:

| File | Role |
|---|---|
| `src/auth/getTabloomToken.ts` | Acquires an **access token** for Tabloom's AAD app (`VITE_TABLOOM_CLIENT_ID`) with scope `api://<id>/access_as_user` |
| `src/services/tabloomApi.ts` | Typed `fetch` wrappers for `/api/integrations/workshop/pages` and `/api/integrations/workshop/pages/:id` |
| `src/pages/NotebookList.tsx` | Lists pages from Tabloom |
| `src/pages/NotebookPage.tsx` | Renders a single page's exported HTML inside `.tabloom-content` |
| `src/styles/tabloom-content.css` | Scoped CSS matching Tabloom's HTML export format |

**Token type matters.** Tabloom's backend validates JWT audience against both `<guid>` and `api://<guid>` (fixed in `5d84e72`). Workshop sends an **access token** (not an ID token). Tabloom's own frontend sends ID tokens — both are accepted.

**CORS.** Tabloom's App Service `ALLOWED_ORIGINS` is set to `https://workshop.enzolopez.net`. The OPTIONS preflight must not be challenged with auth (fixed in `d9d43e0` — Tabloom skips `requireAuth` for OPTIONS).

**Required build args** (both needed in `deploy.yml` and `docker-compose.yml`):
- `VITE_TABLOOM_API_BASE_URL` — Tabloom's origin (`https://app-tabloom-prod-lwxhu7jxlrbtu.azurewebsites.net`)
- `VITE_TABLOOM_CLIENT_ID` — Tabloom's AAD client ID (`b30f09b9-e100-4aa5-af22-ce359ff13fba`)

## Anthropic SDK usage

`server.js` uses `claude-sonnet-4-6` at two call sites (`/api/projects/analyze-url`, `/api/shaper-projects/analyze-url`). If editing these, the `claude-api` skill applies. The model id is hardcoded — there's no version-shim layer.
