# AuditOS

Multi-tenant audit practice platform for small audit firms: working papers with preparer/reviewer/partner
sign-off, ISA/ISQM-oriented checklists, and draft IFRS for SMEs financial statements.

Spec: [docs/superpowers/specs/2026-10-26-auditos-design.md](docs/superpowers/specs/2026-10-26-auditos-design.md)
Plan: [docs/superpowers/plans/2026-10-26-auditos-foundation-to-fs-slice.md](docs/superpowers/plans/2026-10-26-auditos-foundation-to-fs-slice.md)

## Run it locally

Needs Node 22+, pnpm, and PostgreSQL 16 binaries (the project runs its own private cluster on port 5433, separate from any Postgres service).

```powershell
pnpm install
powershell -File scripts/dev.ps1      # starts Postgres (5433), migrates, seeds, API (4010) and web (3000)
```

- Web app: http://localhost:3000
- API: http://localhost:4010 (the web app proxies `/api/*` to it, so cookies stay same-origin)

Seeded users are synthetic (`@example.test`). The random password and each user's authenticator secret are written to
`apps/api/.seed-credentials.local.json` (git-ignored). Print the current code for a user:

```powershell
pnpm --filter @auditos/api totp partner@firm-a.example.test
```

Seeded roles per firm (`Demo Firm A` and `Demo Firm B`): `firm-admin`, `partner`, `manager`, `senior`, `staff`, `quality-officer`, `eqr`
(for example `manager@firm-b.example.test`).

## Tests

```powershell
pnpm test          # unit + API/database tests (needs the local Postgres running)
pnpm typecheck
pnpm lint
pnpm --filter @auditos/e2e test    # Playwright, own database (auditos_e2e) and ports 3100/4110
```

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API. Every route declares `config.access`; startup fails otherwise. |
| `apps/web` | Next.js app (nonce-based CSP, server-side session check on every page). |
| `packages/db` | Roles, migrations, row-level security, audit-log and document-control triggers. |
| `packages/authz` | Role, grade and state policy shared by API and tests. |
| `packages/fs-engine` | Pure trial balance to statements engine (IFRS for SMEs 2nd and 3rd edition by period). |
| `packages/standards` | Checklist templates and disclosure checklists (draft wording, labelled unreviewed). |
| `packages/exports` | DOCX, XLSX and PDF output with DRAFT marking. |
| `e2e` | Playwright flows. |

## Security model in one paragraph

Tenant = audit firm. Every tenant table has row-level security forced on and the API connects as a role that cannot bypass it.
Engagements are visible only to their members. Reviewed work cannot change without its sign-offs being revoked (database trigger),
items are never hard-deleted, locked engagements are immutable, and unlock and approved-item deletion need a second person. All of
it is recorded in a per-firm, hash-chained, append-only audit log written by the database. Login needs a password and an
authenticator code; sign-off, deletion approval, unlock and export need a fresh code (step-up).

## Deploying to Render

`render.yaml` is a blueprint: a Postgres 16 database, the API (with a disk for evidence files) and the web app, all in Frankfurt.
After creating it from the repo:

1. The API's pre-deploy step creates the application database roles and runs migrations. Check the first deploy log: the roles
   need a database login that may create roles. If Render refuses, the migration step prints the error.
2. Create the first firm: `POST /platform/tenants` on the API with header `x-platform-token: <PLATFORM_ADMIN_TOKEN>` and body
   `{ "name": "Firm name", "adminEmail": "admin@firm.example" }`. The response carries a one-time `inviteToken`; open
   `https://<web-host>/accept-invite?token=...` to set the password, then sign in and set up the authenticator.
3. Everything is demo-grade until the data residency question is settled. Do not load real client data.

## Known gaps in this build

- Hosting region: Render has no African region; Kenya data residency is unresolved.
- No WebAuthn (TOTP only), no real malware scanner (a stub marks files clean), evidence is stored on local disk (no object lock).
- ISQM 1 firm-level quality module, AQR pack, client portal, farming/pension/investment packs, full IFRS statements and
  narrative notes in exports are not built yet.
- Checklist and disclosure wording is firm-authored draft text and must be reviewed by a qualified person before use.
- Invites are returned as links; there is no email delivery or notification system yet.
