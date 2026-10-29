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
pnpm --filter @auditos/api totp grace.kangethe@kangethe.example.test
```

While testing locally you can skip the authenticator: set `DEV_FIXED_OTP=123456` in `.env.local` and restart the API; every account then accepts `123456` for sign-in and step-up. The API refuses to start with it in production, so it cannot reach Render. Remove the line when you want to test the real authenticator.

Seeded people are named, one account each (no shared logins). Kangethe & Associates: Wanjiru Mugo (firm administrator), Grace Kangethe (partner), Daniel Otieno (manager), Faith Njeri (senior), Brian Kiptoo (staff), Mercy Achieng (quality officer), Samuel Kariuki (EQR). Waweru & Associates: Peter Maina, Joseph Waweru, Esther Wairimu, Kevin Mutua, Lucy Chebet, Hassan Abdi, Alice Nduta. Emails are `firstname.lastname@kangethe.example.test` and `...@waweru.example.test`.

## Demo guide: who sees what (Kangethe & Associates)

Four clients, three account managers and teams, so each profile sees something different. Everyone except the firm administrator lands on **Today**, which greets them by first name, lists what needs them (papers to review, overdue invoices, year ends coming up) with an Open link on each row, and shows a "What you can see" panel. Wanjiru starts on Clients.

**The side menu** is grouped, and a role only sees the groups it can use: Today; **My work** (Calendar, Timesheet); **Clients and audits** (Clients, Engagements); **Business** (Prospects, Billing); **Firm** (Quality and independence, People); Help. Billing has tabs (Overview, Invoices, Quotations, Sent emails, Settings) and Quality and independence has two (Independence, Activity history), each shown only to the people who could always see them.

| Person | Role | Clients they see | Why |
|---|---|---|---|
| Grace Kangethe | Partner | all four | partner; engaged on Mwangaza and Lakeview, view only on the other two |
| Charles Kamau | Partner | all four | partner; engaged on Savannah and Umoja, view only on the other two |
| Daniel Otieno | Manager | Mwangaza, Lakeview | manages Mwangaza, on the Lakeview team |
| Ruth Wambui | Manager | Savannah, Umoja | manages both |
| Faith Njeri | Senior | Mwangaza, Savannah | on both teams |
| Brian Kiptoo | Staff | Mwangaza, Lakeview | on both teams |
| Tom Odhiambo | Staff | none | on no team |
| Mercy Achieng / Samuel Kariuki | Quality officer / EQR | Mwangaza | on its team |
| Wanjiru Mugo | Firm administrator | all four (list only) | administrator; cannot open files or reveal personal details |

**Prospects** (the old Pipeline; the address is still /pipeline). Six prospects across the team, shown as a table you can switch to cards, with stage buttons, a search box and, for managers and partners, a "Show prospects of" person filter. Click a row to open it and see Move to, Hand over and Make a client, or use the ... button. Staff and seniors see only what they own (Brian: Baraka Hauliers; Tom: Kito Logistics); managers and partners see all six and the totals by person. The firm administrator has no Prospects page.

**Calendar.** Month, Day, Work week and Week views, with a legend to switch kinds of event on and off, and (for managers and partners) **See by person** to put a day side by side by colleague. A week of events for the current and next week. Brian sees his fieldwork but not the Savannah meetings; Tom sees only his leave; Grace and Charles see everything; managers see the events of people on their teams.

**Account managers.** Grace can change a client's account manager from the client page; Daniel cannot. Wanjiru cannot switch Ruth off while Ruth manages clients, and the Hand over panel lists what she holds.

**Time and billing.** Rates (staff 1,500, senior 2,500, manager 4,500, partner 9,000 per hour), taxes (VAT 16%, excise duty 10%, VAT on excise), fees per job, three weeks of time and expenses, and invoices in different states.
- Brian and the other staff log time and expenses on the **Timesheet** and see no rates, values, invoices or billing.
- Daniel (manager) sees **Billing** for his own engagements, the Mwangaza invoice (issued, part paid, marked PRACTICE ONLY), the overdue Lakeview invoice, and quotations; he cannot see Ruth's draft Savannah invoice.
- Grace (partner) sees the whole firm, issues invoices and records payments, and sets rates and taxes. Wanjiru (administrator) sees invoicing but not hours.
- Invoices are issued in practice mode (no real KRA connection) and say "PRACTICE ONLY" on screen and on the PDF. Email is not sent either: messages are kept under **Billing > Sent emails**.

Waweru & Associates is a second firm with no clients, to show that firms never see each other.

## Tests

```powershell
pnpm test          # unit + API/database tests (needs the local Postgres running)
pnpm typecheck
pnpm lint
pnpm --filter @auditos/e2e e2e     # Playwright, own database (auditos_e2e) and ports 3100/4110
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
it is recorded in a per-firm, hash-chained, append-only audit log written by the database. Login needs a password and a
six-digit code from a phone app; sign-off, deletion approval, unlock and export need a fresh code (step-up).

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
