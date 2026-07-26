# A full-stack document reader

Upload a PDF or image and it opens immediately in the browser — text
extraction ("scan to text") is a separate, on-demand step, not something
every upload pays the OCR/parsing cost for up front. Built as a small
reference project covering the skills in a typical junior/mid developer
job posting. Each section below points at the exact file that demonstrates
the point, so it doubles as interview-prep material.

## Stack

- **Backend**: Node.js + Express, PostgreSQL (`pg`), `pdf-parse` for PDFs, `tesseract.js` for OCR on images
- **Frontend**: plain HTML/CSS/JS (no build step, so it's easy to read end-to-end)
- **Infra**: PostgreSQL (Docker optional — see below), GitHub Actions CI/CD

## Running it locally — no Docker required

The API serves the frontend itself (see `backend/src/app.js`), so the only
things you need installed are **Node.js 18+** and **PostgreSQL**. This path
was tested end-to-end (register, login, session, RBAC) against a real local
Postgres install.

**1. Install PostgreSQL** if you don't have it already.
- Windows: https://www.postgresql.org/download/windows/ (the installer
  also gives you `psql`)
- macOS: `brew install postgresql@16 && brew services start postgresql@16`
- Linux: `sudo apt install postgresql`

**2. Create the database and user** (run `psql` as the postgres superuser):
```sql
CREATE USER doc_reader_app WITH PASSWORD 'change-me';
CREATE DATABASE document_reader OWNER doc_reader_app;
```

**3. Configure and run the backend:**
```bash
cd backend
cp .env.example .env
# edit .env if your Postgres user/password/port differ from the defaults,
# and set BOOTSTRAP_ADMIN_EMAILS to the email you'll register with
npm install
npm run migrate
npm start
```

**4. Open http://localhost:4000** — that's the whole app, frontend
included. Click "create one" and register with the email you put in
`BOOTSTRAP_ADMIN_EMAILS` to get the first `admin` account; everyone else
who registers comes back as `user` until an admin promotes them from the
"admin panel" link that appears in the header nav once you're signed in
as an admin.

For active development, `npm run dev` uses nodemon to restart on file changes.

## Running it with Docker (optional)

If you'd rather not install Postgres locally, `docker-compose.yml` runs
Postgres + the API (which still serves the frontend) in containers:

```bash
docker compose up --build
docker compose exec api npm run migrate   # first run only
```

Then open http://localhost:4000, same as above — there's no separate
frontend container or port to worry about.

## How this maps to each requirement

### Pages & the view-first, scan-on-demand flow
- **`frontend/index.html`** (reader) — drop a file, it uploads and renders
  immediately: PDFs in an `<iframe>` pointed at `GET /api/documents/:id/file`
  (the browser's native PDF viewer does the rendering, no library needed),
  images in a plain `<img>`. Nothing is extracted yet at this point —
  `documents.status` stays `'uploaded'`.
- **"scan to text" button** — calls `POST /api/documents/:id/extract`,
  which flips status to `'processing'`, runs `pdf-parse` or `tesseract.js`
  (`backend/src/services/extraction.js`), and the frontend polls
  `GET /api/documents/:id` until it's `'done'` or `'failed'`, then fetches
  `GET /api/documents/:id/pages` for the extracted text. This is a
  deliberate separation: most files just get opened and read, not OCR'd —
  no reason to pay that cost on every upload.
- **`frontend/admin.html`** (admin panel) — the user directory lives here
  now, its own page, reachable from the header nav (`frontend/shared.js`
  renders the nav and gates the "admin panel" link to `role === 'admin'`;
  the page itself re-checks the role server-side via `GET /api/users`,
  which is admin-only regardless of what the frontend shows).
- **`frontend/shared.js`** — session bootstrap, login/register form, and
  nav rendering, used by both pages so there's one copy of that logic
  instead of two.

### Authentication & role-based access (admin / executive / officer / user)
- **Session**: `POST /api/auth/login` issues a JWT in an `httpOnly` cookie
  (`backend/src/middleware/auth.js`) — unreadable by frontend JS, which is
  the main defense against session theft via XSS. `GET /api/auth/me`
  restores session state on page load; `POST /api/auth/logout` clears it.
- **Changing your own password**: hover the email in the topbar (any page
  once signed in) to reveal a small ✎ button — it opens a modal
  (`frontend/shared.js` builds it once and injects it into every page,
  rather than duplicating the markup) that calls
  `PATCH /api/auth/password`. That route requires the *current* password,
  not just a valid session — otherwise a hijacked-but-still-open session
  could lock the real owner out by changing it to something only an
  attacker knows. Rate-limited the same as login/register.
- **Bootstrapping the first admin**: set `BOOTSTRAP_ADMIN_EMAILS` in `.env`
  to a comma-separated allowlist. Any of those emails get the `admin` role
  automatically on first registration; everyone else registers as `user`.
  There is no self-service path to a higher role — only an existing admin
  can promote someone, via the admin panel or `PATCH /api/users/:id/role`.
- **Role hierarchy** (`backend/src/utils/roles.js` is the single source of
  truth — the DB `CHECK` constraint, JWT claims, and route guards all
  derive from this one list): `user < officer < executive < admin`.

| Action                          | user | officer | executive | admin |
|----------------------------------|:---:|:---:|:---:|:---:|
| Upload a document                 | ✓ | ✓ | ✓ | ✓ |
| View / read own documents         | ✓ | ✓ | ✓ | ✓ |
| Delete own documents              | ✓ | ✓ | ✓ | ✓ |
| View **all** documents org-wide   |   |   | ✓ | ✓ |
| Delete **any** document           |   |   |   | ✓ |
| View the user directory           |   |   |   | ✓ |
| Change a user's role              |   |   |   | ✓ |
| Suspend / restore an account      |   |   |   | ✓ |

An admin can't demote or deactivate their own account — that guard exists
specifically so a single admin can't accidentally lock the whole org out.

### 5. Software Implementation Methodology (Waterfall & Agile)
The repo is structured for Agile delivery: small, mergeable increments
(upload → extract PDF → extract images → add auth would be four separate
PRs/sprints in practice), a `develop` branch that PRs land on before `main`
(see `.github/workflows/ci.yml` triggers), and CI gating every PR — the
Scrum equivalent of "definition of done" enforced by a robot instead of a
checklist.

### 6. Software environments (Dev / SIT / UAT / Production)
- **Dev**: `npm start` against a local Postgres (or `docker compose up`), `NODE_ENV=development` (`.env.example`)
- **SIT**: the `lint-and-test` CI job — spins up a real Postgres service
  container and runs the app against it, the same shape as production wiring
  but on ephemeral infrastructure
- **UAT / Production**: `build-and-push` publishes a versioned image to
  GHCR; a real deployment would point a staging and then a production
  environment at specific image tags, each with its own `.env` secrets
  injected by the platform, never committed to git

### 7. Security — SQLi, XSS, CSRF
- **SQL Injection**: `backend/src/config/db.js` — the *only* function that
  touches Postgres takes `(text, params)` with `$1, $2...` placeholders.
  Every route (`backend/src/routes/documents.js`) calls it that way; there
  is no string-concatenated SQL anywhere in the codebase to go wrong.
- **XSS**: `frontend/app.js` — extracted document text and error messages
  are written with `.textContent`, never `.innerHTML`. A PDF containing
  `<script>` in its text layer is rendered as inert text, not executed.
  `helmet()` in `app.js` also sets `X-Content-Type-Options` and a
  restrictive default CSP.
- **CSRF**: `backend/src/middleware/csrf.js` — double-submit-cookie
  pattern. Now that sessions are cookie-based (see auth section above),
  this is load-bearing rather than precautionary: the frontend fetches a
  token from `/api/csrf-token` and echoes it back in an `x-csrf-token`
  header on every state-changing request, and the server rejects anything
  where the header doesn't match the cookie — which a third-party site
  can never read, since it isn't `httpOnly` but is same-origin only.

### 8. Version control (Git)
`.gitignore` excludes `node_modules`, `.env`, and uploaded files. Suggested
workflow: `feature/*` branches → PR into `develop` (CI runs) → `develop` →
`main` (CI runs + Docker image published). No secrets ever committed —
`.env.example` is the template, `.env` is gitignored.

### 9. Normalized database design
`backend/db/schema.sql` — three tables in 3NF:
- `documents` (one row per upload)
- `extracted_pages` (one row per page, FK to `documents`, so a 300-page
  PDF doesn't force one giant TEXT blob)
- `processing_jobs` (tracks async extraction status separately from the
  document's own lifecycle)

Indexes are added specifically for the query patterns the API issues
(`idx_extracted_pages_doc_id`, `idx_processing_jobs_status`, etc.) rather
than indexing every column speculatively.

### 10. Web application development
Standard REST shape: `POST /api/documents` (upload), `GET /api/documents/:id`
(status), `GET /api/documents/:id/file` (stream the original for inline
viewing), `POST /api/documents/:id/extract` (kick off text extraction),
`GET /api/documents/:id/pages` (extraction results), `DELETE /api/documents/:id`.
Long-running OCR work happens off the request thread — the client polls
status instead of holding a connection open for 10+ seconds.

**A robustness note on that background job**: `tesseract.js` (the OCR
library) throws worker errors directly instead of rejecting its promise
when it doesn't get an `errorHandler` — an uncaught exception that would
otherwise crash the *entire server*, not just the one upload that triggered
it. `extraction.js` passes an `errorHandler` to avoid that, and
`extractDocument` also wraps the whole job in a timeout
(`EXTRACTION_TIMEOUT_MS`, default 90s) so that if a job still hangs for
some other reason — a stalled network call, a worker that dies without
posting a message back — it resolves to `'failed'` instead of leaving a
document stuck on `'processing'` forever. `app.js` also registers
`process.on('uncaughtException'/'unhandledRejection')` as a last line of
defense: one bad background job should never take the app down for
everyone else's session.

### 11. DevOps — CI/CD & containerization
- `Dockerfile` (repo root) — multi-stage build, bundles backend + frontend
  into one image so the container runs a single process, non-root user,
  container `HEALTHCHECK`
- `docker-compose.yml` — API+frontend (one container) + Postgres, with a
  dependency healthcheck so the API won't start until Postgres is ready.
  Docker is optional, though — see "Running it locally" above for the
  Postgres-only, no-Docker path.
- `.github/workflows/ci.yml` — lint → migrate → test on every PR; on
  merge to `main`, builds and pushes a tagged image to GHCR with a
  placeholder deploy step showing where a real staging/prod rollout hooks in

## Project layout

```
backend/
  src/
    app.js              — Express app, security middleware wiring
    config/db.js         — the only file allowed to touch Postgres
    middleware/          — upload validation, CSRF, error handling, auth (JWT + RBAC)
    routes/               — auth.js, users.js (admin only), documents.js
    services/extraction.js — pdf-parse / tesseract.js logic
    utils/roles.js        — single source of truth for the role hierarchy
    __tests__/            — supertest coverage for auth, RBAC, and CSRF
  db/schema.sql          — normalized schema + indexes
frontend/
  index.html          — reader page: upload, inline view, scan-to-text
  admin.html          — admin panel page (user directory), admin-only
  shared.js           — session bootstrap, login/register form, nav
  reader.js           — index.html logic
  admin.js            — admin.html logic
  style.css
  — no build tooling, served directly by Express
Dockerfile
docker-compose.yml
.github/workflows/ci.yml
```

## What's deliberately left out (and why)

- **Password reset / email verification** — a real deployment needs both,
  but they mainly add a transactional-email dependency rather than new
  concepts; omitted to keep the reference focused.
- **Kubernetes** — `docker-compose` covers the "containerization"
  requirement without the added complexity of a K8s manifest set, which
  would be the natural next step for a real production deployment.
