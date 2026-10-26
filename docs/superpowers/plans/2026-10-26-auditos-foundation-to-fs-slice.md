# AuditOS Plan 1: Foundation, Document Control, Checklists, FS Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable-on-localhost multi-tenant audit platform covering spec phases 0, 1 and a thin phase 2: secure tenancy, document control, a checklist engine with starter content, and trial balance to draft IFRS for SMEs statements for trading, consultancy and rental clients.

**Architecture:** pnpm/Turborepo TypeScript monorepo. NestJS (Fastify) API talks to local PostgreSQL 16 through two roles: an owner role for migrations and a non-bypass app role bound to a tenant per transaction (row-level security). Document-control and audit-log rules are enforced by database triggers and functions as well as by the API. Next.js web app consumes the API. `fs-engine` is a pure, deterministic package.

**Tech Stack:** Node 24, pnpm, Turborepo, TypeScript (strict), NestJS + Fastify, Next.js 15 (App Router), PostgreSQL 16 (`pg` + Drizzle for typed queries, plain numbered `.sql` migrations), argon2, otplib (TOTP), zod, Vitest, Playwright, docx, exceljs, pdfkit.

**Spec:** `docs/superpowers/specs/2026-10-26-auditos-design.md`

**Out of this plan (separate later plans):** ISQM 1 firm QMS module and AQR pack (phase 3); full IFRS statements, farming/pension/investment packs, client PBC portal, accounting-package connectors, timesheets, WebAuthn, real malware scanning, S3/object-lock storage, Render deployment (phase 4 and hosting). Where this plan ships a stub for one of these, the task says so.

## Global Constraints

- Tenant = audit firm; every tenant table has `tenant_id uuid NOT NULL`, RLS enabled and forced, composite FKs `(tenant_id, id)`.
- Runtime DB role `auditos_app` has no `BYPASSRLS`, is not owner, and has no UPDATE/DELETE on `audit_events`.
- Roles: `firm_admin`, `partner`, `manager`, `senior`, `staff`, `quality_officer`, `eqr`. Firm admin has no engagement content access by default.
- Item lifecycle: `draft → prepared → manager_reviewed → partner_approved → locked`. Editing a `manager_reviewed` item reverts it to `prepared`. Editing `partner_approved` needs a reason and revokes both sign-offs. Locked engagement: no edits, no deletes.
- No hard deletes of working paper content from the app. Deleting reviewed/approved items needs two-person approval. Unlock needs partner + reason + second approver (another partner or quality officer).
- Audit log: append-only, hash-chained per tenant (`sha256(prev_hash || canonical_json)`), written by triggers for table changes.
- Money is `bigint` minor units (cents) everywhere; never floats.
- Retention default 7 years, configurable per tenant with a floor of 7 years; file assembly deadline default 60 days after report date. Both marked "unverified" in settings UI.
- Frameworks resolved by period: IFRS for SMEs 2nd edition (as amended) for periods beginning before 2027-01-01, 3rd edition for periods beginning on or after 2027-01-01. Full IFRS is declared but "not supported in plan 1" and must return a clear error.
- MFA (TOTP) mandatory for every user before any non-auth endpoint works. Argon2id hashing. Session tokens opaque, stored hashed. Step-up re-auth (TOTP code within 5 min) required for sign-off, unlock, delete approval and export.
- Standards content is firm-authored paraphrase with paragraph references, never verbatim ISA/IFRS text; all starter content is labelled `status: "unreviewed-placeholder"`.
- No real client data or PII anywhere; seeds are synthetic.
- Dev ports: web `http://localhost:3000`, api `http://localhost:4000`.
- Secrets only in `.env.local` (gitignored). `.env.example` has placeholders.
- Match conventions: TypeScript strict, ESM, Vitest, no comments that restate code.

## Review Focus

1. **Trial balance that doesn't balance, has unmapped accounts, or is empty/zero**: FS generation is blocked with a listed exception, never a silently wrong statement. (Task 13)
2. **Sign-off on stale content / concurrent edit**: a sign-off submitted with an outdated content hash is rejected, so a reviewer can't approve what they didn't see. (Task 8)
3. **User belonging to two tenants, or a deactivated reviewer/partner**: tenant context comes only from the session's selected membership; a deactivated user's open sign-offs stay valid but they can't act. (Tasks 5, 6)
4. **Hostile uploads**: extension/MIME mismatch, path traversal in filename, oversized file, zero-byte file. (Task 9)
5. **First-year audit with no comparatives, and credit-balance assets / debit-balance liabilities (e.g. overdraft)**: statements render without prior-year column; balances are presented under the right heading with a flag. (Task 13)

---

## File Structure

```
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .gitignore, .env.example, README.md
apps/api/src/{main.ts,app.module.ts,security/,auth/,tenants/,clients/,engagements/,doc-control/,evidence/,checklists/,review-notes/,financials/}
apps/web/app/...                      Next.js routes
packages/db/{migrations/*.sql,src/{pools.ts,withTenant.ts,schema.ts,migrate.ts,seed.ts}}
packages/audit-log/src/{verify.ts,append.ts}
packages/authz/src/{roles.ts,policy.ts}
packages/standards/{src/{types.ts,generate.ts},content/checklists/*.json,content/disclosures/*.json,content/fs-taxonomy.json}
packages/fs-engine/src/{money.ts,framework.ts,mapping.ts,statements.ts,cashflow.ts,disclosures.ts}
packages/exports/src/{docx.ts,xlsx.ts,pdf.ts}
packages/config/                      shared tsconfig/eslint
e2e/                                  Playwright
scripts/dev.ps1
```

---

### Task 1: Monorepo scaffold and tooling

**Files:**
- Create: root configs above, `packages/config/*`, `.github/workflows/ci.yml`, `.gitleaks.toml`
- Create: `packages/fs-engine/src/index.ts` and `packages/fs-engine/test/smoke.test.ts` (minimal package to prove the toolchain)

**Interfaces:**
- Produces: scripts `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` at root running via Turborepo; workspace names `@auditos/<dir>`.

- [ ] **Step 1: Write failing test** `packages/fs-engine/test/smoke.test.ts`: `expect(version()).toBe('0.0.0')` importing `version` from `../src`.
- [ ] **Step 2: Run** `pnpm test` → FAIL (no workspace yet).
- [ ] **Step 3: Scaffold** `git init`, pnpm workspace (`apps/*`, `packages/*`), Turborepo pipeline, strict base tsconfig, ESLint with `@typescript-eslint` and `eslint-plugin-security`, Vitest per package, `version(): string` in fs-engine. CI workflow runs install, typecheck, lint, test, `pnpm audit --prod`, gitleaks. `.gitignore` covers `.env*` except `.env.example`, `node_modules`, `.next`, `dist`, `storage/`.
- [ ] **Step 4: Run** `pnpm install && pnpm typecheck && pnpm test` → all PASS.
- [ ] **Step 5: Commit** `chore: scaffold monorepo`

### Task 2: Database package, roles, tenancy and RLS

**Files:**
- Create: `packages/db/migrations/0001_roles_tenancy.sql`, `src/pools.ts`, `src/withTenant.ts`, `src/migrate.ts`, `src/schema.ts`
- Test: `packages/db/test/tenancy.test.ts`

**Interfaces:**
- Produces: `createPools(env: NodeJS.ProcessEnv): { owner: Pool; app: Pool }`; `withTenant<T>(pool: Pool, ctx: { tenantId: string; userId: string }, fn: (tx: PoolClient) => Promise<T>): Promise<T>` (opens transaction, `set_config('app.tenant_id', ..., true)` and `app.user_id`); `migrate(owner: Pool): Promise<void>`. Tables `tenants(id, name, settings jsonb, created_at)`, `users(id, email unique, password_hash, mfa_secret_enc, mfa_enabled, active, failed_logins, locked_until)`, `memberships(tenant_id, user_id, role, grade, active)`.

**Needs from user at execution:** local PostgreSQL 16 superuser credentials, placed in `.env.local` as `PG_SUPERUSER_URL` (never committed). Migration 0001 creates database `auditos`, roles `auditos_owner` and `auditos_app` (no BYPASSRLS, passwords from env), and `pgcrypto`.

- [ ] **Step 1: Write failing tests** in `tenancy.test.ts`: `tenant A cannot read tenant B rows` (insert a membership for each tenant, `withTenant(A)` selecting memberships returns only A's); `no tenant context returns zero rows`; `app role cannot bypass RLS` (`SELECT rolbypassrls FROM pg_roles WHERE rolname='auditos_app'` is false); `cross-tenant insert is rejected` (insert with other `tenant_id` throws).
- [ ] **Step 2: Run** `pnpm --filter @auditos/db test` → FAIL.
- [ ] **Step 3: Implement** migration SQL with `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_id = current_setting('app.tenant_id', true)::uuid` on `memberships` (and a helper SQL function `app_tenant()` for reuse by later migrations), migration runner tracking applied files in `schema_migrations`, and the TS helpers. `users` is not tenant-scoped; app role gets only the column grants it needs.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `feat(db): roles, tenancy and RLS`

### Task 3: Tamper-evident audit log

**Files:**
- Create: `packages/db/migrations/0002_audit_log.sql`, `packages/audit-log/src/{append.ts,verify.ts}`
- Test: `packages/audit-log/test/audit.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `createPools` from Task 2.
- Produces: `appendEvent(tx: PoolClient, e: { action: string; entityType: string; entityId?: string; detail?: unknown }): Promise<void>`; `verifyChain(owner: Pool, tenantId: string): Promise<{ ok: true } | { ok: false; brokenAtSeq: number }>`; SQL function `audit_attach(tbl regclass)` that installs a row-change trigger on a table; table `audit_events(tenant_id, seq, at, actor_user_id, action, entity_type, entity_id, detail jsonb, prev_hash, hash)` with per-tenant sequence serialised by `pg_advisory_xact_lock`.

- [ ] **Step 1: Write failing tests:** `appends chained events` (two events, second `prev_hash` equals first `hash`, `verifyChain` ok); `app role cannot update or delete events` (both throw permission denied); `tampering is detected` (owner role edits a row's `detail`, `verifyChain` returns `brokenAtSeq` of that row); `trigger logs inserts on an attached table` (attach to `memberships`, insert, event exists with actor from `app.user_id`); `concurrent appends keep a gapless chain` (20 parallel appends, seqs 1..20).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** migration (hash computed in SQL with `digest(prev_hash || canonical jsonb text, 'sha256')`, REVOKE UPDATE/DELETE/TRUNCATE from `auditos_app`, RLS on `audit_events` allowing INSERT and SELECT for own tenant only), `audit_attach` applied to `memberships`; TS wrappers.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(audit-log): hash-chained append-only log`

### Task 4: API bootstrap, security baseline, authentication and MFA

**Files:**
- Create: `apps/api/src/{main.ts,app.module.ts}`, `security/{headers.ts,rate-limit.ts,csrf.ts}`, `auth/{auth.controller.ts,auth.service.ts,session.guard.ts,stepup.ts}`, `packages/db/migrations/0003_sessions.sql`
- Test: `apps/api/test/auth.e2e.test.ts`

**Interfaces:**
- Consumes: pools, `withTenant`, `appendEvent`.
- Produces: HTTP `POST /auth/login {email,password}` returns `{ mfaRequired: true, challengeId }`; `POST /auth/mfa/verify {challengeId, code}` sets session cookie (HttpOnly, SameSite=Lax, Secure when `NODE_ENV=production`); `POST /auth/mfa/enroll` (returns otpauth URI, only for logged-in-but-not-enrolled challenge); `POST /auth/stepup {code}`; `POST /auth/logout`; `GET /me` returns `{ userId, memberships[], activeTenantId, role }`; `POST /auth/select-tenant {tenantId}`; guard `@RequireStepUp()`; `SessionGuard` loads `req.actor: { userId; tenantId; role; grade }`. Sessions table stores SHA-256 of token, idle timeout 30 min, absolute 12 h.

- [ ] **Step 1: Write failing tests:** `login without MFA verify gets no session`; `wrong password increments failed_logins and locks after 5` with the same generic error as unknown email; `valid TOTP completes login and sets HttpOnly cookie`; `/me rejects expired idle session`; `state-changing request without CSRF header is 403`; `security headers present` (CSP, HSTS in prod, X-Content-Type-Options, frame-ancestors none); `rate limit returns 429 after 10 login attempts/min/IP`; `no stack trace in 500 body`; `route without a policy decorator fails startup` (test calls a checker that scans controllers).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with argon2id, otplib (secret encrypted with `APP_ENC_KEY` AES-256-GCM before storage), `@fastify/helmet`, `@fastify/rate-limit`, double-submit CSRF token; global deny-by-default guard requiring a `@Policy(...)` or `@Public()` decorator on every route; audit events for login success/failure/lockout/logout.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): secure bootstrap, sessions, TOTP MFA`

### Task 5: Authorization policy package

**Files:**
- Create: `packages/authz/src/{roles.ts,policy.ts}`
- Test: `packages/authz/test/policy.test.ts`

**Interfaces:**
- Produces: `type Role`; `GRADE: Record<Role, number>` (staff 1, senior 2, manager 3, partner 4); `type Action = 'engagement.read' | 'item.edit' | 'item.signoff.prepared' | 'item.signoff.manager' | 'item.signoff.partner' | 'item.delete.request' | 'item.delete.approve' | 'engagement.unlock' | 'engagement.transition' | 'tenant.admin' | 'export'`; `can(actor: Actor, action: Action, ctx: PolicyCtx): { allow: boolean; reason?: string }` where `PolicyCtx` has `assigned: boolean`, `preparerId?: string`, `engagementPartnerId?: string`, `eqrId?: string`, `itemState?`, `engagementState?`, `approverId?: string`.

- [ ] **Step 1: Write failing tests:** `firm_admin cannot read engagement content`; `unassigned manager cannot read engagement`; `preparer cannot sign off own work`; `reviewer grade must exceed preparer grade`; `engagement partner cannot be EQR`; `only partner may sign off partner level`; `unlock requires an approver different from requester and being partner or quality_officer`; `deactivated user is denied everything`; `locked engagement denies item.edit for all roles`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `can` as a pure function with a rule table; deny by default.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(authz): role and state policy`

### Task 6: Tenant and user administration, synthetic seed

**Files:**
- Create: `apps/api/src/tenants/*`, `packages/db/src/seed.ts`
- Test: `apps/api/test/tenants.e2e.test.ts`

**Interfaces:**
- Produces: `POST /admin/users {email, role}` (firm_admin; creates invited user with one-time enrolment link), `PATCH /admin/users/:id {active?, role?}`, `GET /admin/users`; `POST /platform/tenants` guarded by `PLATFORM_ADMIN_TOKEN` env (creates a tenant and first firm_admin); seed script creating tenants "Demo Firm A" and "Demo Firm B" with one user per role each, all emails `@example.test`, known dev password printed to console and TOTP secrets printed once.

- [ ] **Step 1: Write failing tests:** `firm_admin lists only own tenant users`; `tenant A admin cannot patch tenant B user (404)`; `user with memberships in A and B only acts in the selected tenant`; `deactivating a user kills their sessions immediately`; `role change is audit logged`; `platform endpoint rejects missing/wrong token`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** controllers with `@Policy('tenant.admin')`; attach audit triggers to `memberships`; seed script idempotent.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: tenant/user admin and synthetic seed`

### Task 7: Clients, engagements, state machine and gates

**Files:**
- Create: `packages/db/migrations/0004_clients_engagements.sql`, `apps/api/src/{clients,engagements}/*`
- Test: `apps/api/test/engagements.e2e.test.ts`

**Interfaces:**
- Produces: tables `clients(id, tenant_id, name, sector, legal_form, framework, year_end_month, ...)`, `engagements(id, tenant_id, client_id, period_start, period_end, state, partner_id, eqr_id, report_date, locked_at, risk_profile jsonb)`, `engagement_members(engagement_id, user_id, tenant_id)`; sectors enum `trading|consultancy|rental|farming|pension|investment`; `POST /clients`, `POST /engagements`, `POST /engagements/:id/members`, `POST /engagements/:id/transition {to}`; pure function `gateFor(from: EngagementState, to: EngagementState): GateCheck[]` in `apps/api/src/engagements/gates.ts` returning named checks that run against the DB (e.g. `acceptanceApproved`, `materialityApproved`, `mandatoryChecklistComplete`, `eqrSignedWhereRequired`).

- [ ] **Step 1: Write failing tests:** `engagement visible only to assigned members and partner role in same tenant`; `cannot skip states` (planning → completion 409); `planning→fieldwork blocked until materiality item is partner_approved`; `fieldwork→completion blocked while mandatory checklist items are open`, response lists them; `auto-lock at assembly deadline` (service method `lockDueEngagements(now)` locks engagements whose `report_date + 60d` passed); `assigning a user without a current independence declaration is rejected`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, RLS and audit triggers on all three tables; independence declaration modelled as a working paper item of kind `independence_declaration` created in Task 8.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: clients, engagements, gated state machine`

### Task 8: Document control (edit, review, delete, lock)

**Files:**
- Create: `packages/db/migrations/0005_doc_control.sql`, `apps/api/src/doc-control/{doc-control.service.ts,doc-control.controller.ts}`
- Test: `apps/api/test/doc-control.e2e.test.ts`, `packages/db/test/doc-control-triggers.test.ts`

**Interfaces:**
- Consumes: `can` (Task 5), `appendEvent`, `@RequireStepUp()`.
- Produces: tables `wp_items(id, tenant_id, engagement_id, kind, title, content jsonb, state, version int, content_hash, deleted_at, deleted_reason)`, `wp_item_versions`, `signoffs(item_id, level, user_id, content_hash, at, revoked_at, revoked_reason)`, `deletion_requests(id, item_id, requested_by, approved_by, reason, status)`, `unlock_events(engagement_id, requested_by, approved_by, reason, at)`. Service methods: `createItem`, `editItem(itemId, patch, actor, reason?)`, `signOff(itemId, level, expectedHash, actor)`, `requestDelete(itemId, reason, actor)`, `approveDelete(requestId, actor)`, `unlockEngagement(engagementId, reason, approverId, actor)`; `GET /items/:id/history`. DB trigger `wp_items_guard` rejects any UPDATE/DELETE of `content` when the engagement is locked and rejects all hard DELETEs unless `current_setting('app.purge','t') = 'on'` (retention only, owner role).

- [ ] **Step 1: Write failing tests:** `editing a manager_reviewed item reverts it to prepared and revokes the manager sign-off`; `editing partner_approved without reason is 400; with reason revokes both and bumps version`; `sign-off with stale content_hash is rejected 409`; `sign-off stores the content hash`; `preparer cannot sign off own item`; `delete of draft by preparer soft-deletes with reason`; `delete of reviewed item needs second approver; requester cannot approve own request`; `soft-deleted item remains in history`; `hard DELETE via app role fails at the database`; `edit on locked engagement fails at the database even if API check is bypassed`; `unlock needs different partner/quality_officer approver, reason, and logs event`; `post-lock addendum creates a new dated item and leaves originals untouched`; `sign-off without step-up is 401`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** versions written in the same transaction as every edit; `content_hash = sha256` of canonical JSON of `{title, content}` computed in SQL; sign-offs, edits, deletes, unlocks each emit audit events.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: document control with revoke-on-edit, two-person delete, lock/unlock`

### Task 9: Evidence uploads

**Files:**
- Create: `apps/api/src/evidence/{evidence.controller.ts,storage.ts,scan.ts,validate.ts}`, `packages/db/migrations/0006_evidence.sql`
- Test: `apps/api/test/evidence.e2e.test.ts`

**Interfaces:**
- Produces: `interface BlobStore { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; }` with `LocalBlobStore` rooted at `./storage` (S3 adapter later); `interface Scanner { scan(data: Buffer): Promise<{ clean: boolean }> }` with `StubScanner` (always clean, logs that it is a stub); `validateUpload(name: string, mime: string, data: Buffer): { ok: true; safeName: string; sha256: string } | { ok: false; reason: string }`; `POST /items/:id/evidence` (multipart, 25 MB cap), `GET /evidence/:id/download` (short-lived signed token, `Content-Disposition: attachment`). Evidence rows are `wp_items`-style protected: soft delete only, locked engagements immutable.

- [ ] **Step 1: Write failing tests:** `rejects extension/magic-byte mismatch` (png bytes named .pdf); `rejects zero-byte and >25MB`; `sanitises ../../etc/passwd filename to a safe name and stores under a generated key`; `rejects .html/.svg/.exe`; `stores sha256 and download returns identical bytes`; `download of another tenant's file is 404`; `quarantined (scan not clean) file is not downloadable`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** allow-list (pdf, png, jpg, xlsx, docx, csv, txt) with magic-byte sniffing; storage keys `tenantId/engagementId/uuid`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: evidence uploads with validation and hashing`

### Task 10: Standards package (checklist templates and generator)

**Files:**
- Create: `packages/standards/src/{types.ts,generate.ts}`, `content/checklists/{acceptance,planning,fieldwork-core,completion,sector-trading,sector-consultancy,sector-rental}.json`
- Test: `packages/standards/test/generate.test.ts`

**Interfaces:**
- Produces: `type ChecklistItem = { id: string; ref: string; question: string; mandatory: boolean; when?: Condition; standardRefs: string[] }` where `standardRefs` are paragraph references only (e.g. "ISA 315 (Revised 2019) para 19"); `type Condition` supports `sector`, `riskFlag`, `framework`; `generateChecklists(profile: { sector: Sector; framework: Framework; riskFlags: string[] }, templates: Template[]): GeneratedChecklist[]`; every template has `{ id, version, status: 'unreviewed-placeholder', effectiveFrom }`. Starter set covers: acceptance and continuance, independence, planning/materiality, risk assessment, fraud, going concern, related parties, laws and regulations, revenue, inventory (trading), receivables, payables, bank, payroll, completion, subsequent events, representations, plus sector packs for trading, consultancy, rental.

- [ ] **Step 1: Write failing tests:** `rental profile includes investment property items, trading includes inventory counts, consultancy includes WIP/revenue recognition`; `farming profile yields core items only and a "sector pack not available" notice`; `riskFlag fraud adds extra items`; `every item carries at least one standardRef and no question text exceeds 400 chars` (guards against pasted standard text); `all templates have unreviewed-placeholder status`; `generation is deterministic`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** generator and author the JSON content (paraphrased, own wording).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(standards): checklist templates and generator`

### Task 11: Checklist engine and review notes API

**Files:**
- Create: `packages/db/migrations/0007_checklists.sql`, `apps/api/src/{checklists,review-notes}/*`
- Test: `apps/api/test/checklists.e2e.test.ts`

**Interfaces:**
- Consumes: Task 10 `generateChecklists`, Task 8 doc-control (each checklist is a `wp_items` row of kind `checklist`; responses live in `content`).
- Produces: `POST /engagements/:id/checklists/generate` (pins `template_id@version` on each); `PATCH /checklists/:id/items/:itemId {response: 'yes'|'no'|'na', rationale?, evidenceIds?}` routed through `editItem`; `GET /engagements/:id/completeness` returns `{ mandatoryOpen: ItemRef[], percent: number }`; `POST /items/:id/review-notes {text}`, `POST /review-notes/:id/clear`, `POST /review-notes/:id/accept`.

- [ ] **Step 1: Write failing tests:** `answer 'na' or 'no' without rationale is 400`; `generated checklist pins template version and later template updates do not alter it`; `completeness lists mandatory unanswered items`; `answering a manager-reviewed checklist reverts review (inherits Task 8)`; `review note must be cleared or accepted before partner signoff`; `reviewer cannot clear their own raised note when they are also the preparer`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: checklist engine and review notes`

### Task 12: fs-engine core: money, framework resolution, mapping

**Files:**
- Create: `packages/fs-engine/src/{money.ts,framework.ts,mapping.ts}`, `packages/standards/content/fs-taxonomy.json`
- Test: `packages/fs-engine/test/{money,framework,mapping}.test.ts`

**Interfaces:**
- Produces: `type Money = bigint`; `parseMoney(s: string): Money` (exact decimal to cents, rejects more than 2 decimals and non-numeric); `formatMoney(m: Money): string`; `resolveFramework(f: 'IFRS_SME' | 'FULL_IFRS', periodStart: string): 'IFRS_SME_2E' | 'IFRS_SME_3E'` (throws `UnsupportedFrameworkError` for `FULL_IFRS`); `type TbLine = { code: string; name: string; debit: Money; credit: Money }`; `type Mapping = Record<string /*account code*/, string /*fs line id*/>`; `mapTrialBalance(tb: TbLine[], mapping: Mapping): { lines: Map<string, Money>; unmapped: TbLine[]; totalDebit: Money; totalCredit: Money; balanced: boolean }`; `suggestMapping(tb: TbLine[], prior?: Mapping): Mapping` (keyword suggestions, prior mapping wins). Taxonomy lines cover SoFP, profit or loss, equity, cash flow heads for trading, consultancy, rental.

- [ ] **Step 1: Write failing tests:** `parseMoney('10.05') === 1005n`, `'10.005'` throws, `'1e3'` throws, `'-5.00'` is `-500n`; `resolveFramework('IFRS_SME','2026-12-31')` is `IFRS_SME_2E`, `'2027-01-01'` is `IFRS_SME_3E`, `FULL_IFRS` throws `UnsupportedFrameworkError`; `unbalanced TB reports balanced=false`; `unmapped accounts are returned, not dropped`; `empty TB returns balanced=true with no lines but flagged by Task 13`; `prior mapping is reused over suggestions`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(fs-engine): money, framework resolution, TB mapping`

### Task 13: fs-engine statements, cash flow and disclosure checklist

**Files:**
- Create: `packages/fs-engine/src/{statements.ts,cashflow.ts,disclosures.ts}`, `packages/standards/content/disclosures/ifrs-sme-2e.json`, `ifrs-sme-3e.json`
- Test: `packages/fs-engine/test/{statements,cashflow,disclosures}.test.ts` plus `test/golden/*.json` (one golden statement set per sector: trading, consultancy, rental)

**Interfaces:**
- Consumes: Task 12 types.
- Produces: `buildStatements(m: MappedTb, opts: { periodStart: string; periodEnd: string; framework: 'IFRS_SME'; prior?: MappedTb }): { ok: true; statements: Statements; exceptions: Exception[] } | { ok: false; blockers: Exception[] }` where blockers are `unbalanced`, `unmapped`, `empty`; `Statements = { sofp, pl, equity, cashflow, notes }` each with current and optional prior columns; `buildCashFlowIndirect(current: MappedTb, prior: MappedTb): { statement: CashFlow; exceptions: Exception[] }` (needs prior, otherwise returns exception `no-comparatives` and omits the statement); `disclosureChecklist(framework: 'IFRS_SME_2E' | 'IFRS_SME_3E', statements: Statements): { id: string; ref: string; satisfied: boolean }[]`. Credit-balance assets and debit-balance liabilities are reclassified to the opposite heading with exception `reclassified-balance`.

- [ ] **Step 1: Write failing tests:** `assets equal liabilities plus equity for golden TBs` (also as a fast-check property over random balanced TBs); `unbalanced TB returns ok:false with blocker unbalanced and no statements`; `unmapped account blocks with the account listed`; `empty or all-zero TB blocks with 'empty'`; `first-year audit builds statements with no prior column and cash flow omitted with no-comparatives exception`; `bank overdraft (credit balance in bank) shows under current liabilities with reclassified-balance exception`; `profit for the year flows into retained earnings in equity statement`; `cash flow net movement equals change in cash and equivalents`; `golden files match for trading, consultancy, rental`; `3E checklist differs from 2E for a period starting 2027-01-01` (checklists are chosen by `resolveFramework`); `building twice gives identical output`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (pure functions, no I/O). Author the two disclosure JSON files as paraphrased, unreviewed placeholders.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(fs-engine): statements, cash flow, disclosure checklist`

### Task 14: Financials API, TB import and exports

**Files:**
- Create: `packages/db/migrations/0008_financials.sql`, `apps/api/src/financials/*`, `packages/exports/src/{docx.ts,xlsx.ts,pdf.ts}`
- Test: `apps/api/test/financials.e2e.test.ts`, `packages/exports/test/exports.test.ts`

**Interfaces:**
- Consumes: Task 12–13, Task 8 (TB, mapping and adjustments are protected `wp_items`).
- Produces: `POST /engagements/:id/tb/import` (CSV/XLSX with columns `code,name,debit,credit`; rejects malformed rows with row numbers), `PUT /engagements/:id/mapping`, `POST /engagements/:id/adjustments`, `GET /engagements/:id/statements` (returns `buildStatements` result using the framework resolved from the engagement period), `POST /engagements/:id/export {format: 'docx'|'xlsx'|'pdf'}` (`@RequireStepUp()`, audit logged); `exportDocx(s: Statements, meta): Promise<Buffer>`, `exportXlsx(...)`, `exportPdf(...)`. All exports carry a DRAFT watermark/header until the engagement state is `partner_approved` or later, plus the exporting user and timestamp in the footer. Prior-year TB and mapping carry forward from the client's previous engagement when present.

- [ ] **Step 1: Write failing tests:** `import rejects a row with non-numeric amount and names the row`; `import of CSV with formula-injection cell (=cmd...) stores it as inert text and exports it escaped`; `adjustments change statements`; `statements for another tenant's engagement is 404`; `export without step-up is 401`; `exports are non-empty, DRAFT-marked before approval and unmarked after partner_approved`; `prior-year mapping is reused for the next engagement`; `FULL_IFRS client returns 422 with a clear message`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: financial statements API, TB import, exports`

### Task 15: Web app: auth, shell and engagement list

**Files:**
- Create: `apps/web/app/{layout.tsx,login/,mfa/,(app)/layout.tsx,(app)/page.tsx,(app)/clients/,(app)/engagements/}`, `apps/web/lib/api.ts`
- Test: `apps/web/test/api.test.ts` (client wrapper adds CSRF header, handles 401 by redirecting)

**Interfaces:**
- Consumes: API endpoints from Tasks 4, 6, 7.
- Produces: pages for login, MFA enrol/verify, tenant switch, role-aware dashboard (partner: engagements at risk; manager: my reviews; staff: my tasks), client list/create, engagement list/create. `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`. Strict CSP, no inline scripts, server-side session check on every `(app)` route. Use the `frontend-design:frontend-design` skill for visual design; WCAG 2.1 AA.

- [ ] **Step 1: Write failing test** for `apiFetch` (CSRF header present, 401 triggers redirect callback).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the pages and wrapper.
- [ ] **Step 4: Run** unit test → PASS; then `pnpm dev` and confirm `http://localhost:3000/login` loads.
- [ ] **Step 5: Commit** `feat(web): auth shell, dashboard, clients, engagements`

### Task 16: Web app: engagement workspace

**Files:**
- Create: `apps/web/app/(app)/engagements/[id]/{page.tsx,checklists/,evidence/,review/,financials/,history/}`
- Test: `apps/web/test/workspace.test.ts`

**Interfaces:**
- Consumes: Tasks 7–14 endpoints.
- Produces: engagement workspace tabs: Overview (state, gate blockers), Checklists (answer with required rationale, completeness bar), Evidence (upload, hash shown), Review (notes, sign-off buttons with step-up modal, stale-hash conflict message), Financials (TB import, mapping table with unmapped highlight, statements preview, exceptions list, disclosure checklist, export buttons with step-up), History (per-item audit trail, delete requests, unlock flow). Controls hidden or disabled when `can()` denies, with the denial reason shown.

- [ ] **Step 1: Write failing tests:** `sign-off button disabled with reason for the preparer`; `stale-hash 409 shows "content changed, re-review" and refreshes`; `export triggers step-up modal first`; `locked engagement renders read-only`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): engagement workspace`

### Task 17: End-to-end, local run and handover

**Files:**
- Create: `e2e/{review-flow.spec.ts,isolation.spec.ts}`, `scripts/dev.ps1`, `README.md`

**Interfaces:**
- Produces: `scripts/dev.ps1` (migrate, seed, start api and web); README with setup, `.env.local` keys, seed users and how to generate TOTP codes, and the list of known gaps (WebAuthn, real malware scanning, S3/object-lock, Kenya residency decision, content unreviewed).

- [ ] **Step 1: Write failing E2E tests:** `review-flow`: staff prepares checklist, manager signs off, staff edit reverts review, manager re-signs, partner approves, delete request needs second approver, engagement locks, unlock needs a second approver; `isolation`: Demo Firm A user cannot open any Demo Firm B URL (engagement, evidence, export) and gets 404.
- [ ] **Step 2: Run** `pnpm e2e` → FAIL.
- [ ] **Step 3: Implement** scripts and fix whatever the E2E uncovers.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` → all PASS; `pnpm audit --prod` has no high/critical; verify `http://localhost:3000` and `http://localhost:4000/health` respond.
- [ ] **Step 5: Commit** `chore: e2e, dev script, README`

---

## Self-review notes

- **Spec coverage:** sections 4.1–4.4, 4.6, 5, 6, 8, 9 (local-applicable parts) map to Tasks 2–16. Not covered here and listed up front: 4.5 ISQM QMS, 4.7 report/management-letter generators, 4.8 practice management, full IFRS, client portal. Section 4.1 conflicts check, engagement-letter generation and AML record are not covered either; they go into Plan 2 with the ISQM module.
- **Type consistency:** `Actor`/`PolicyCtx` (Task 5) used by Tasks 8, 11; `MappedTb` (Task 12) used by Tasks 13–14; `withTenant` signature stable from Task 2.
- **Known deliberate gaps:** WebAuthn, real AV scanning and S3 are stubbed or deferred; each has an interface so the swap is local.
