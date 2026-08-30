# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Cross-app standards** (versioning, Key Vault/secrets, deploy/CI, auth, iOS readiness, Azure registry) are defined in the canonical [azure-infra/STANDARDS.md](../azure-infra/STANDARDS.md). Consult it first; it wins over this file for shared conventions.

## Deploy reality (READ FIRST)

Production runs on **Azure App Service (Linux container)** — not Docker on a self-hosted box, not IIS.

- Resource: `app-workshop-prod-lwxhu7jxlrbtu` in resource group `rg-personal-apps-prod`
- Image: App Service is pinned to `acrenzolopez01.azurecr.io/workshop@sha256:<digest>`; the `latest` alias is promoted from that same inspected digest
- Public URL: <https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net>
- Verify: `curl https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net/api/health` → exact image `sha`/`version`, process `instance`, `/home/data/workshop.db`, and exporter readiness
- Backend env vars (`AZURE_HOME_TENANT_ID` or legacy `AZURE_TENANT_ID`, `API_AUDIENCE`, `ALLOWED_OID`, `ANTHROPIC_API_KEY`, optional `THINGIVERSE_APP_TOKEN`, optional `PROVIDER_TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_TOKEN_ENCRYPTION_KEY`, `DB_PATH=/home/data/workshop.db`, `UPLOADS_PATH=/home/data/uploads`) live in **App Service → Configuration**, not in committed files. `PROVIDER_TOKEN_ENCRYPTION_KEY` falls back to a domain-separated key derived from `SESSION_SECRET`. `ALLOWED_OID` is the primary-user / legacy-migration key, not an access gate. Home-tenant Entra DBs retain `/home/data/users/<oid>.db`; other tenants use `/home/data/users/<tid>_<oid>.db`; Apple keys are unchanged.
- SQLite, uploads, and verified rollback bundles persist under the App Service mounted storage at `/home/data`; Docker defaults now match that layout. Same-volume bundles are not DR: encrypted off-host export and drills remain required (see `RECOVERY.md`).

**Deploy pipeline.** `.github/workflows/deploy.yml` is the live prod pipeline. It builds only `workshop:<full-sha>`, bakes immutable SHA/version metadata plus the Vite configuration into the image, resolves and inspects the exact digest, rejects `/home` image volumes, locks the SHA tag, and digest-pins App Service. Deployment succeeds only after one replacement process returns three consecutive exact-SHA health responses and the read-only demo, auth boundary, live exporter, one-worker/Always On, `/home/data`, and unchanged-setting gates pass; only then does `latest` move to the verified digest. Any failed candidate restores the prior exact App Service and `latest` digests. The workflow reads `version.json`; it never commits a version bump, so it cannot recursively redeploy. The authority remains `common`, and the deployment OIDC `AZURE_TENANT_ID` remains the separate compute tenant.

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
| OIDC service-principal IDs `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID` in `deploy.yml` env | Look like secrets | Not secrets. The federated credential scopes them to this repo + branch. Safe to commit; do not move them into GitHub Secrets. |

## Architecture in 60 seconds

- **Frontend.** React 19 + Vite 8 + Tailwind v4 + React Router v7. The whole route table is in `src/App.tsx` — adding a view = add a page in `src/pages/`, add a `<Route>`. `src/main.tsx` initializes MSAL **before** rendering and registers the instance with `services/api.ts` via `setMsalInstance()`; without that step, every API call ships without a token.
- **State.** No store. Each page fetches its own data via `src/services/api.ts` (typed `fetch` wrappers). All types live in `src/types/project.ts`.
- **Backend.** Single file: `server.js`. The schema (`CREATE TABLE IF NOT EXISTS`), additive migrations (`ALTER TABLE ADD COLUMN` guarded by `PRAGMA table_info`) and prepared statements are wrapped in **`initSchema(db)`** and **`buildStmts(db)`** factories — they run **per database**, not once at load. Order is: constants → `initSchema`/`buildStmts` → `getUserDb`/`getDemoDb`/`resolveReadDb` (per-OID resolution) → helpers → auth middleware → routes → `app.listen`.
- **Per-user DB isolation (READ THIS before touching data code).** There is **no shared global `db`**. Home-tenant Microsoft users keep `USERS_DIR/<oid>.db`; external Entra and MSA users use `USERS_DIR/<tid>_<oid>.db`; Apple keys remain `apple_<sha256(sub)>`. GUIDs are lowercase-canonicalized. The `/api` middleware attaches the selected database as `req.db` / `req.stmts`.
  - **Seed template.** The legacy DB snapshot backs demo mode only. New accounts start empty.
  - **Legacy migration.** The primary home-tenant user identified by `ALLOWED_OID` inherits the legacy `workshop.db` by rename.
- **Auth.** Entra access tokens use Microsoft's common JWKS, exact API audiences (`<client-id>` for v2 and `api://<client-id>` for v1 compatibility), required `access_as_user`, and an issuer derived from and bound to the GUID `tid`. The app registration needs `api.requestedAccessTokenVersion: 2` and an enabled, user-consentable delegated scope. Current Apple sign-in remains independent. Public image routes resolve `?userKey=` (`?oid=` is a legacy alias).
- **Account deletion.** Authenticated `DELETE /api/account` derives the account only from the bearer principal. Apple-backed accounts revoke every stored refresh token at Apple's `/auth/revoke` before local purge; `revoked_at` and `account_deletion_files` checkpoint partial progress so provider/filesystem failures remain retryable. The route then removes the entire isolated DB plus account-only uploads and returns `{ "success": true }`. Workshop Apple access/refresh JWTs carry the DB's `auth_state.session_generation`, so deleting or recreating an account cannot leave an old session usable. The route is registered before the general DB middleware so an idempotent Entra retry cannot recreate an empty workspace.
- **Recovery.** `recovery.js` creates atomic, checksummed whole bundles of the legacy/seed/per-user SQLite DBs plus uploads. Production capture briefly quiesces `/api`, uses SQLite's online backup API (so WAL sidecars are not copied), validates DB integrity and every file reference, then applies whole-bundle retention. `RECOVERY.md` is the restore/DR runbook. `/home/data/backups` is same-volume rollback only; live Azure must export encrypted bundles off-host.
- **Demo mode.** A request with header `X-Demo: 1` is unauthenticated, read-only, and served from the shared seed snapshot (`getDemoDb`); any non-GET returns 403. The frontend flag lives in `src/demo/demoMode.ts` (sessionStorage), `AuthGuard` bypasses MSAL when set, `src/services/api.ts` sends `X-Demo` on GETs and blocks writes before they leave the browser, and the landing page has a **Demo** button.
- **Adding a new endpoint.** Prepared statement in `stmts` → handler in `server.js` matching neighbouring patterns → typed wrapper in `src/services/api.ts` → type in `src/types/project.ts`.

## Active work — invariants to preserve

- **Notebook feature** (`src/pages/NotebookList.tsx`, `src/pages/NotebookPage.tsx`, routes `/notebook`, `/notebook/:id`, `/notebook/new`). The notebook UI is an **editable window onto Tabloom** — there are no local `notebook_pages` tables in Workshop. Pages are fetched, updated, and created via Tabloom's `/api/integrations/workshop/*` endpoints in `src/services/tabloomApi.ts`. The wire format is plain Markdown (`body_md`); Tabloom converts to/from its canonical ProseMirror store. Tabloom-only blocks (callouts, figures with mediaId, inline tags) round-trip via raw HTML / `tabloom://tag/` Markdown links — visible in source, preserved on save, but not editable in Workshop's textarea. The token is a Tabloom-scoped access token obtained by `src/auth/getTabloomToken.ts`. Concurrency is optimistic: `updateTabloomWorkshopPage` sends `expected_edited_at` and returns `{ ok: false, reason: 'conflict', current }` on 409 so `NotebookPage.tsx` can show a Reload / Overwrite prompt. Preview tab renders Markdown via `marked` and re-uses `src/styles/tabloom-content.css` for fidelity with Tabloom's own export.
- **Tabloom integration auth flow** — `src/auth/getTabloomToken.ts` acquires an AAD **access token** (not an ID token) with scope `api://<TABLOOM_CLIENT_ID>/access_as_user`. **Azure AD prerequisites:** Tabloom's app registration must expose the `access_as_user` scope, and Workshop's app registration must have that delegated permission granted + admin-consented. If this breaks with 401, check Tabloom's `requireAuth` — it must accept `api://` audience format and the v1 STS issuer (`sts.windows.net`).
- **Vite build-time env var pipeline** (`Dockerfile`, `docker-compose.yml`, `deploy.yml`). `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_HOME_TENANT_ID`, `VITE_AZURE_AUTHORITY_TENANT_ID`, `VITE_TABLOOM_API_BASE_URL`, and `VITE_TABLOOM_CLIENT_ID` are baked into the bundle. The home tenant remains fixed for legacy data-key compatibility; the production authority is `common`.
- **`cut_list_items` table.** Either `project_id` or `shaper_project_id` is set, never both — enforced by a `CHECK` constraint. The migration that adds this (`server.js` ~140-187) recreates the table; it must run with `foreign_keys = OFF` and restore to ON in a `finally` block.
- **Bambu Hub import** (`/api/bambu-projects*`, `/api/bambu-assets/:id`, `/api/provider-connections*`). Provider adapters accept only MakerWorld, Thingiverse, and Printables URLs, keep redirects on provider-owned media hosts, validate every host against public addresses, stream to random local filenames, reject error pages, and cap imports at 40 MB/image, 250 MB/file, 1 GB/project, and 5 GB/account. Printables supports anonymous file downloads. MakerWorld exposes metadata/images but requires sign-in for original files; Workshop never collects MakerWorld credentials, and users add downloaded originals through authenticated multipart upload. Thingiverse uses a write-only official token encrypted per user (or optional server-wide `THINGIVERSE_APP_TOKEN`). Only `/api/bambu-assets/:id/image?userKey=` is auth-exempt; model/file GETs require bearer auth. Provider limitations and individual download failures persist in `import_warnings`; never replace them with success-shaped fallbacks or browser-cookie scraping.

## How to verify changes

| Goal | Command |
|---|---|
| Type-check (frontend + shared types) | `npx tsc -b` — there is **no** `npm run typecheck` alias |
| Production build (also type-checks) | `npm run build` |
| Run locally (two terminals) | `npm run server` then `npm run dev` (Vite proxies `/api` → `:3006`) |
| Account deletion tests | `npm test` |
| Recovery bundle tests | `node --test test/recovery.test.js` |
| Verify / drill a bundle | `npm run recovery -- verify <bundle>` then `npm run recovery -- drill <bundle>` |
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
