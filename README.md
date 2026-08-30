# The Workshop — Project Companion

A browser-native woodworking project companion built around a Living Plan Table. Capture ideas, plan cut lists, track materials and costs, log build progress, record finishes, and import projects from Shaper Tools Hub or public 3D-model libraries — with optional AI-assisted parsing, per-user storage, and a read-only demo.

---

## What it does

| Feature | Description |
|---|---|
| **Project tracker** | Full lifecycle from idea → planning → in progress → completed, with difficulty, estimated hours, wood types, and tool lists |
| **Cut list** | Per-project parts list with dimensions (length × width × thickness) and material |
| **Cut plan optimizer** | Visual guillotine-packing layout for sheet goods — enter stock sheets and kerf, get an SVG layout with waste % |
| **Materials list** | Shopping-list items with qty, cost, and purchased checkboxes; cost totals auto-calculated |
| **Build log** | Timestamped notes with optional photo attachments — a running journal of the build |
| **Finish log** | Record finish products, type (stain, oil, poly…), color, coat count, and date applied |
| **Project links** | Relate projects to each other (companion piece, sequel build, etc.) |
| **Project templates** | Save any project as a reusable template; clone it with one click |
| **Shopping list** | Cross-project view of all unpurchased materials, grouped by project |
| **Shaper Hub import** | Paste a Shaper Tools Hub share URL — AI extracts title, description, materials, instructions, and all project photos |
| **Bambu Hub import** | Paste a MakerWorld, Thingiverse, or Printables URL — preserve attribution, copy public source images, locally store accessible STL/3MF/CAD files, and upload protected originals manually |
| **AI URL analysis** | Analyze any inspiration URL to pre-fill a new project's fields (title, description, difficulty, wood types, cut list, materials) |
| **Unit conversions** | Live millimeter/inch converter plus exact decimal, fractional, and millimeter reference tables |
| **Image gallery** | Upload sketches and inspiration photos per project; PDF plans supported; hero image shown on project cards |
| **Notebook** | Edit Tabloom pages as Markdown with preview, conflict handling, keyboard save, and unsaved-change safeguards |
| **Settings** | Light/dark/system appearance, annotation color, text size, project defaults, project-summary export, identity, sign-out, and account deletion |
| **Read-only demo** | Browse seeded project, Shaper, shopping, conversion, template, and inspiration surfaces without an account |

---

## Tech stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | React 19 with TypeScript (strict mode) |
| Routing | React Router v7 (`<Routes>` / `<Route>`) |
| Build tool | Vite 8 + `@vitejs/plugin-react` |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` plugin) + global CSS variables |
| Icons | Lucide React |
| Fonts | Browser/system UI with an SF Rounded-like system stack for focal headings |
| Auth client | `@azure/msal-react` + `@azure/msal-browser` (Azure AD) |

TypeScript is compiled with `tsc -b` then bundled by Vite. `noUnusedLocals`, `noUnusedParameters`, and `strict` are all on.

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (ESM, `"type": "module"`) |
| HTTP framework | Express 5 |
| Database | SQLite via `better-sqlite3` (WAL mode, foreign keys ON) |
| File uploads | Multer (disk storage, MIME validation via `file-type`) |
| Auth | JWT validation with `jose` against Azure AD and Apple/Workshop sessions |
| Rate limiting | `express-rate-limit` on AI-powered routes |
| AI | `@anthropic-ai/sdk` — `claude-sonnet-4-6` for analysis, `claude-haiku-4-5` available for fast tasks |
| Environment | `dotenv` |

The HTTP backend is centered in `server.js`; reusable backup/restore logic lives in `recovery.js`. The SQLite schema is declared inline with `CREATE TABLE IF NOT EXISTS`. There is no migration framework; additive changes use guarded `ALTER TABLE` statements at startup.

### Deployment

| Mode | How |
|---|---|
| Local dev | Two processes: `npm run server` + `npm run dev` (or `npm run start:all` in Git Bash) |
| Local Docker | Three-stage `node:22-alpine` Dockerfile; `docker compose up` |
| Production | GitHub Actions builds a full-SHA image, inspects its exact digest, promotes that digest to `latest`, and digest-pins Azure App Service |

---

## Project structure

```
Workshop/
├── server.js               # Entire Express API — schema, auth, routes
├── recovery.js             # Atomic DB + upload backup/restore bundles
├── RECOVERY.md             # Production recovery and DR runbook
├── vite.config.ts          # Vite config; proxies /api → :3006
├── tsconfig.app.json       # TypeScript config for src/
├── docker-compose.yml      # Single-service compose; named volume for /home/data
├── Dockerfile              # deps → builder → runner (three-stage)
├── deploy.ps1              # PowerShell deploy script (build → up → health check)
├── .env.example            # All supported env vars with comments
│
└── src/
    ├── main.tsx            # Entry point — MSAL provider wraps <AuthGuard>
    ├── App.tsx             # Lazy route table, route fallback, page titles, and global states
    ├── index.css           # Global styles, CSS custom properties, media queries
    │
    ├── auth/
    │   ├── AuthGuard.tsx   # MSAL/demo bootstrap and authentication progress
    │   ├── LandingPage.tsx # Microsoft sign-in and read-only demo entry
    │   └── msalConfig.ts   # MSAL PublicClientApplication config
    │
    ├── components/
    │   ├── AppShell.tsx        # Responsive sidebar/mobile shell and account controls
    │   ├── ProjectCard.tsx     # Dashboard card for a workshop project
    │   ├── ShaperProjectCard.tsx # Dashboard card for a Shaper Hub project
    │   ├── StatusBadge.tsx     # Colored pill for project status
    │   ├── CutPlanOptimizer.tsx # Stock sheet inputs → calls cutPlan.ts → renders CutPlanSheet
    │   ├── CutPlanSheet.tsx    # SVG layout rendering for a single sheet
    │   └── ErrorBoundary.tsx   # React error boundary — wraps the app
    │
    ├── pages/
    │   ├── Dashboard.tsx           # Project grid + template shelf + Shaper Hub section
    │   ├── ProjectDetail.tsx       # Full project view — all tabs, build/finish logs, gallery
    │   ├── ProjectForm.tsx         # Create/edit workshop project with AI analyze
    │   ├── ShaperProjectDetail.tsx # Read-only Shaper Hub project view
    │   ├── ShaperProjectForm.tsx   # Create/edit Shaper Hub project with AI analyze + cut list
    │   ├── ConversionTables.tsx    # Live converter and woodworking reference tables
    │   ├── NotebookList.tsx        # Tabloom-backed notebook index
    │   ├── NotebookPage.tsx        # Markdown editor, preview, and conflict handling
    │   ├── Settings.tsx            # Appearance, defaults, summary export, and account actions
    │   └── ShoppingList.tsx        # Cross-project materials to buy
    │
    ├── lib/
    │   ├── cutPlan.ts          # Guillotine packing algorithm (BSSF scoring, kerf, rotation)
    │   ├── conversions.ts      # Exact conversion/reference fixtures
    │   ├── notebook.ts         # Notebook persistence and dirty-state helpers
    │   └── coreWorkflows.ts    # Shared project, Shaper, and shopping transformations
    │
    ├── services/
    │   └── api.ts          # Typed fetch wrappers for every API endpoint
    │
    └── types/
        └── project.ts      # All shared TypeScript interfaces and enums
```

---

## Local development setup

### Prerequisites

- Node.js 22+
- An Azure AD tenant (required for auth — see [Auth setup](#auth-setup) below)
- An Anthropic API key (optional — AI features degrade gracefully without it)

### Steps

**1. Clone and install**

```bash
git clone <repo-url>
cd Workshop
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Open `.env` and fill in the required values (all described in the file). At minimum you need:

```env
PORT=3006
DB_PATH=./workshop.db

ANTHROPIC_API_KEY=                 # optional — AI features disabled if blank

AZURE_HOME_TENANT_ID=<your-home-tenant-id>
API_AUDIENCE=<your-app-client-id>

VITE_AZURE_AUTHORITY_TENANT_ID=common
VITE_AZURE_HOME_TENANT_ID=<your-home-tenant-id>
VITE_AZURE_CLIENT_ID=<your-app-client-id>

ALLOWED_OID=                       # optional legacy-DB owner oid
```

**3. Start both servers**

In two terminals:

```bash
# Terminal 1 — API on :3006
npm run server

# Terminal 2 — Vite dev server on :5180, proxies /api to :3006
npm run dev
```

Or in one Git Bash terminal:

```bash
npm run start:all
```

> `start:all` uses `&` for background processes and works in Git Bash. Use two terminals on Windows cmd/PowerShell.

**4. Open the app**

Navigate to `http://localhost:5180`. The SQLite database (`workshop.db`) and uploads directory are created automatically on first run.

### Validation

```bash
npm test       # Node regression suite, including auth, data isolation, cut-plan parity, and web surfaces
npx tsc -b     # Strict TypeScript check
npm run build  # Production bundle and route chunks
```

No linter is configured.

---

## Auth setup

Authentication is handled by Microsoft Entra ID. The frontend requests `api://<client-id>/access_as_user` and sends that access token to the API. The backend validates RS256 signatures with Microsoft's common JWKS, accepts only the configured API audience, requires `access_as_user`, and binds the issuer to the token's GUID `tid`.

### Register an app in Microsoft Entra ID

1. Go to **Azure Portal → Microsoft Entra ID → App registrations → New registration**
2. Name it (e.g. `Workshop Dev`)
3. Choose **Accounts in any organizational directory and personal Microsoft accounts** and set **Redirect URI** to `http://localhost:5180` (Single-page application type)
4. After registration, note:
   - **Application (client) ID** → `API_AUDIENCE` and `VITE_AZURE_CLIENT_ID`
   - The original **Directory (tenant) ID** → `AZURE_HOME_TENANT_ID` and `VITE_AZURE_HOME_TENANT_ID`
5. Under **Expose an API**, set the Application ID URI to `api://<client-id>` and add delegated scope `access_as_user`; enable it and allow user consent.
6. In the app registration manifest, set `api.requestedAccessTokenVersion` to `2`.
7. Under **Authentication**, ensure **Access tokens** are enabled for the SPA platform.

### Configure the frontend MSAL client

For an app registration that accepts any Entra tenant plus personal Microsoft accounts, set `VITE_AZURE_AUTHORITY_TENANT_ID=common`. Keep `VITE_AZURE_HOME_TENANT_ID` fixed so existing users retain their data paths.

```ts
export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_AUTHORITY_TENANT_ID}`,
    redirectUri: 'http://localhost:5180',
  },
  ...
};
```

Home-tenant users retain the existing `<oid>.db` path. Other Entra tenants and personal Microsoft accounts use `<tid>_<oid>.db`, preventing cross-tenant object-ID collisions. `ALLOWED_OID` is only the owner key for migrating a legacy single-user database; it is not an access gate.

### Configure Sign in with Apple

The native iOS client sends both `identityToken` and the one-time `authorizationCode` from `ASAuthorizationAppleIDCredential`:

```json
{ "id_token": "...", "authorization_code": "...", "name": "Optional first-login name" }
```

The server verifies the ID token, exchanges the code at Apple's `/auth/token` endpoint, encrypts the returned refresh token with AES-256-GCM, and stores it in that user's database. `authorization_code` is accepted as optional only so already-shipped clients can continue signing in; those legacy sessions must complete one fresh sign-in on a current client before deleting the account. Configure `SESSION_SECRET`, `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, and `APPLE_TOKEN_ENCRYPTION_KEY`; see [`.env.example`](.env.example). The private key, session secret, and token-encryption key are runtime secrets and must be supplied through Key Vault in production.

---

## Database

SQLite files live at `DB_PATH` and `USERS_DIR` (local defaults are repository-relative; the production root is `/home/data`). No migration tool — the schema is declared with `CREATE TABLE IF NOT EXISTS` at startup. Additive migrations (`ALTER TABLE ... ADD COLUMN`) run automatically on startup for existing databases.

### Tables

| Table | Purpose |
|---|---|
| `projects` | Core project records — title, description, status, difficulty, wood types, tools, template flag |
| `project_images` | Images attached to projects — stored on disk (`file_path`), or as external URLs (`image_url`) |
| `cut_list_items` | Parts list rows — shared by both `projects` and `shaper_projects` via nullable FK columns |
| `materials` | Per-project materials with cost and purchased flag |
| `build_log_entries` | Timestamped journal entries with optional photo attachment (stored on disk) |
| `finish_log_entries` | Finish product records — type, color, coats, date |
| `project_links` | Many-to-many project relationships (one direction stored, UNION query provides both) |
| `shaper_projects` | Shaper Tools Hub projects — URL, description, photo, materials JSON, instructions |
| `user_profile` | Single-row persisted name/email profile for Sign in with Apple |
| `auth_state` | Per-account session generation used to revoke Workshop access and refresh tokens |
| `apple_credentials` | Encrypted Apple refresh tokens, client IDs, and durable revocation progress |
| `account_deletion_files` | Restartable queue of account-only upload files pending physical removal |

Images and build log photos are stored as files under `UPLOADS_PATH` (`./uploads/` in dev, `/home/data/uploads/` in Docker). The DB stores only the filename; the Express route serves the file.

### Backup and recovery

Production creates atomic, checksummed bundles containing every isolated SQLite
database and every upload. Capture pauses API traffic, uses SQLite's online
backup API for WAL safety, validates DB/file references, and retains complete
bundles only. See [the recovery runbook](RECOVERY.md) for configuration,
verification, restore drills, account-deletion implications, and the
managed-identity off-host exporter.

---

## AI features

### Project URL analysis (`POST /api/projects/analyze-url`)

Fetches the given URL, strips HTML to plain text, and sends it to `claude-sonnet-4-6` with a structured extraction prompt. Returns a pre-filled project payload: title, description, difficulty, estimated hours, wood types, tools needed, cut list, and materials.

### Shaper Hub analysis (`POST /api/shaper-projects/analyze-url`)

Same fetch-and-extract pattern, but with Shaper-specific output fields. Additionally:
- Extracts `__NEXT_DATA__` (Next.js SSR page props JSON) from the page `<script>` tag — gives Claude structured data instead of scraped text
- Extracts `application/ld+json` blobs for additional structured context
- Returns `image_urls[]` — all project photo URLs found in the structured data, shown as removable thumbnails before saving

If `ANTHROPIC_API_KEY` is not set, both endpoints return a `503` with a clear message. All other app features continue to work.

**SSRF protection**: both analyze endpoints resolve the target URL's hostname via DNS and reject requests to private/loopback IP ranges before fetching.

---

## API reference

Except for the documented health/image exemptions and Apple sign-in exchange, routes require an `Authorization` Bearer token containing either a valid Entra access token or Workshop access token.

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/apple` | Verify `{ id_token, authorization_code?, name? }`, exchange a supplied one-time code with Apple, and return Workshop access/refresh tokens |
| `POST` | `/api/auth/refresh` | Rotate a valid Workshop refresh token |

### Account

| Method | Path | Description |
|---|---|---|
| `DELETE` | `/api/account` | Permanently delete the authenticated caller's isolated database and unshared uploaded files |

The account is derived only from the verified Bearer token; the endpoint accepts no user identifier. Success is `200` with `{ "success": true }`. For Apple-backed accounts, the server first revokes every stored Apple refresh token at `/auth/revoke`; provider failure returns `502 { "error": "apple_token_revocation_failed" }` and leaves local data intact for retry. Successful token revocations and local file cleanup are durably checkpointed, so a later retry resumes rather than repeating completed work. Pre-migration Apple accounts without a stored token return `409 { "error": "apple_reauthentication_required" }` and must complete one fresh Apple sign-in. Missing/invalid authentication returns `401`; all other failures also return a non-success `{ "error": "..." }` response.

Successful deletion removes projects, templates, Shaper and Bambu data, downloaded 3D assets, cut/material/shopping data, images/BLOBs, build/finish logs, legacy notebook rows, profile/auth/Apple credential state, and invalidates all Workshop access/refresh tokens issued for that account. Entra users' Workshop data is deleted, but their Microsoft account and Entra grant are not.

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — returns `{ status, db }` |
| `GET` | `/api/projects` | List all non-template projects (summary with hero image id, cost, parts count) |
| `GET` | `/api/projects/:id` | Full project detail — includes images, cut list, materials, build log, finish log, links |
| `POST` | `/api/projects` | Create project |
| `PUT` | `/api/projects/:id` | Update project fields |
| `DELETE` | `/api/projects/:id` | Delete project and all related data (cascade) |
| `POST` | `/api/projects/analyze-url` | AI-analyze a URL and return suggested project fields |

### Images

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/projects/:id/images` | Upload a file (`multipart/form-data`) or register a URL (`{ url, kind }`) |
| `GET` | `/api/images/:id` | Serve image file (or redirect to external URL) |
| `DELETE` | `/api/images/:id` | Delete image (removes file from disk) |

### Cut list

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/projects/:id/cut-list` | Add a part |
| `PUT` | `/api/cut-list/:id` | Update a part |
| `DELETE` | `/api/cut-list/:id` | Delete a part |

### Cut plan config

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/cut-plan-config` | Load saved stock sheet / kerf configuration |
| `PUT` | `/api/projects/:id/cut-plan-config` | Save cut plan configuration |

### Materials

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/projects/:id/materials` | Add a material |
| `PUT` | `/api/materials/:id` | Update a material |
| `DELETE` | `/api/materials/:id` | Delete a material |
| `PATCH` | `/api/materials/:id/purchased` | Toggle purchased flag |
| `GET` | `/api/shopping-list` | All unpurchased materials across all projects |

### Build log

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/build-log` | List entries for a project |
| `POST` | `/api/projects/:id/build-log` | Add entry (note + optional photo upload) |
| `GET` | `/api/build-log/:id/image` | Serve the attached photo |
| `DELETE` | `/api/build-log/:id` | Delete entry (removes photo file from disk) |

### Finish log

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/finish-log` | List finish entries |
| `POST` | `/api/projects/:id/finish-log` | Add finish entry |
| `PUT` | `/api/finish-log/:id` | Update finish entry |
| `DELETE` | `/api/finish-log/:id` | Delete finish entry |

### Project links

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/links` | List related projects (bidirectional UNION query) |
| `POST` | `/api/projects/:id/links` | Add a relationship link |
| `DELETE` | `/api/project-links/:id` | Remove a link |

### Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/templates` | List all templates |
| `POST` | `/api/projects/:id/save-as-template` | Clone a project as a template |
| `POST` | `/api/templates/:id/clone` | Create a new project from a template (atomic transaction) |
| `DELETE` | `/api/templates/:id` | Delete a template (guards against deleting regular projects) |

### Shaper Hub projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/shaper-projects` | List all Shaper Hub projects |
| `GET` | `/api/shaper-projects/:id` | Full detail including images and cut list |
| `POST` | `/api/shaper-projects/analyze-url` | AI-analyze a Shaper Hub URL |
| `POST` | `/api/shaper-projects` | Create Shaper Hub project |
| `PUT` | `/api/shaper-projects/:id` | Update Shaper Hub project |
| `DELETE` | `/api/shaper-projects/:id` | Delete and clean up image files |
| `POST` | `/api/shaper-projects/:id/images` | Upload file or register URL as project image |
| `POST` | `/api/shaper-projects/:id/cut-list` | Add a cut list part |

### Bambu Hub projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/bambu-projects` | List 3D projects with local image/file counts |
| `GET` | `/api/bambu-projects/:id` | Full metadata, durable import warnings, and locally stored assets |
| `POST` | `/api/bambu-projects/analyze-url` | Inspect a supported public model URL and return its metadata and file manifest |
| `POST` | `/api/bambu-projects` | Create the project and stream every accessible public image/model file into per-user storage |
| `PUT` | `/api/bambu-projects/:id` | Update metadata for the same source model |
| `DELETE` | `/api/bambu-projects/:id` | Delete the project and locally stored assets |
| `POST` | `/api/bambu-projects/:id/assets` | Authenticated manual model/CAD/archive upload |
| `GET` | `/api/bambu-assets/:id/image` | Serve a saved image through the existing user-key media contract |
| `GET` | `/api/bambu-assets/:id` | Authenticated model/attachment download |
| `DELETE` | `/api/bambu-assets/:id` | Delete one locally stored asset |
| `GET` | `/api/provider-connections` | Return provider status only; never returns tokens |
| `PUT` | `/api/provider-connections/thingiverse` | Validate and encrypt a write-only official Thingiverse token |
| `DELETE` | `/api/provider-connections/thingiverse` | Remove the account’s Thingiverse token |

Printables currently supports anonymous metadata and file links. MakerWorld permits anonymous metadata/images but requires sign-in for original model files; Workshop never stores MakerWorld credentials or cookies, so download those originals and use **Add files**. Thingiverse accepts an official token from Settings, encrypted per user and never returned to a client; optional `THINGIVERSE_APP_TOKEN` remains a server-wide alternative. Workshop persists provider limitations and individual download failures instead of silently omitting them. Imports are capped at 40 MB per image, 250 MB per file, 1 GB per project, and 5 GB per account.

---

## Local Docker

```bash
# Copy and fill in your env vars
cp .env.example .env

# Build and start the local container
.\deploy.ps1
```

`deploy.ps1` is a local-development convenience. It runs `docker compose build`, brings up the container, waits, then hits the local `/api/health` endpoint. Logs:

```bash
docker compose logs -f workshop
```

The SQLite databases, uploaded files, and local recovery bundles live in a named Docker volume (`workshop-data`) mounted at `/home/data` — they survive rebuilds. Same-volume bundles are not disaster recovery; see [`RECOVERY.md`](RECOVERY.md).

Production is deployed by `.github/workflows/deploy.yml` to Azure App Service. The workflow builds only `workshop:<full-git-sha>`, pulls and inspects its exact digest, rejects image volumes below `/home`, locks the SHA tag, and pins `app-workshop-prod-lwxhu7jxlrbtu` to that digest. It then requires three consecutive health responses from one replacement process with the image-baked SHA/version before checking demo, auth, exporter, worker, Always On, and unchanged App Service settings; only then is `latest` promoted to the verified digest. A failed candidate restores the prior exact App Service and `latest` digests. Do not use `deploy.ps1` for production.

### Environment variables in Docker

Pass secrets via the `.env` file (excluded from the image by `.dockerignore`). The compose file forwards the required auth/AI settings explicitly; `THINGIVERSE_APP_TOKEN` is an optional server-wide connection, while `PROVIDER_TOKEN_ENCRYPTION_KEY` is an optional dedicated per-user token key and otherwise derives from `SESSION_SECRET`. Never use a personal browser cookie. Off-host recovery uses only nonsecret `OFFHOST_BACKUP_*` settings plus the production App Service's system-assigned managed identity.

---

## Cut plan optimizer internals

`src/lib/cutPlan.ts` implements a **guillotine packing algorithm** with **Best Short-Side Fit (BSSF)** scoring:

1. Sort pieces by area descending (largest first)
2. For each piece, try both orientations in every open sheet's free rectangles
3. Score each candidate placement: minimize the shorter leftover dimension (BSSF), break ties by the longer
4. If no open sheet fits, open a new sheet from the stock inventory (respects material + thickness matching)
5. After placing a piece, split the used free rectangle into two new free rectangles (horizontal or vertical split chosen by whichever leaves the more uniform remainder)

Material matching is label-token-based — a stock sheet labeled `"3/4 Baltic Birch"` matches any piece whose material contains both tokens. Thickness matching compares parsed inch values with a 0.005″ tolerance.

---

## Notes for developers

- **Regression suite** — `npm test` covers auth, isolation, deletion, core workflows, and recovery bundles
- **No ORM** — all queries are hand-written prepared statements in the `stmts` object at the top of `server.js`
- **Image storage** — files land in `UPLOADS_PATH`; the DB stores only the filename. Deleting an image row also deletes the file from disk
- **Template cloning** — uses `db.transaction()` to copy cut list rows and materials atomically
- **Auth without AI** — remove `<AuthGuard>` in `src/main.tsx` to run locally without Azure AD (dev convenience only)
- **Adding a route** — add the prepared statement to `stmts`, add the Express handler following the existing pattern, add a typed wrapper to `src/services/api.ts`
