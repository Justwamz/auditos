# Stage 2: named users, assignment-based access, audit trail, PII masking, version history

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Every user is a named person; clients are visible only to people assigned to them (partners and admins see all); every view, change and personal-data reveal is recorded in plain English; personal data is masked by default; every version of a paper is kept immutably and can be compared and restored.

**Architecture:** DB migration 0013 adds `users.full_name`, `memberships.is_admin`, `clients.account_manager_id`, a `can_see_client` function behind the clients RLS policy, `client_contacts` (PII encrypted at rest), an immutability trigger on `wp_item_versions`, and a lookup index on audit events. The API adds a view-logging helper (deduplicated), a sentence renderer for audit events, a contacts module with masking and a logged reveal, and version list/diff/restore routes. The web adds an Audit trail page, a client page with masked contacts, and a History panel on papers.

**Spec:** `docs/superpowers/specs/2026-10-27-auditos-workflow-and-practice-management.md`

## Global Constraints
- App role gets minimum grants; every new route declares `config.access`.
- App-written audit actions stay in an allow-list regex; extend it only to `view` and `pii`.
- PII never leaves the API unmasked except through the reveal route, which requires a reason of 5+ characters and is logged.
- Existing tests stay green; the e2e flows are updated for the named demo logins.

## Review Focus
- A staff member not assigned to a client gets 404 (not 403) from every client route, including contacts and reveal.
- A reveal without a reason, or by someone who cannot see the client, never returns the value and writes no "revealed" event.
- Repeated views inside five minutes write one audit event.
- Version rows cannot be updated or deleted even by the owner role.
- Generic mailbox names (admin, info, accounts, office, support, finance, hr, audit, noreply, team, sales) are refused at invite and at firm creation.

### Task 1: Immutable version history with compare and restore
**Files:** Migration `0013_trust_and_traceability.sql` (trigger part); `apps/api/src/doc-control/versions.ts` (pure `diffContent`) and routes in `doc-control/routes.ts`; Tests `apps/api/test/versions.test.ts`, `apps/api/test/versions.e2e.test.ts`, DB trigger test in `packages/db/test`.
**Interfaces:** `diffContent(a: unknown, b: unknown): { path: string; before: unknown; after: unknown }[]` (leaf-level, dotted paths with `[n]` for arrays, long strings kept whole). `GET /items/:id/versions` → `{ versions: { version, title, editedBy, editedByName, at, reason, contentHash }[] }`. `GET /items/:id/versions/:n/changes` → changes against the previous version (version 1 compares with nothing). `POST /items/:id/restore { version, reason }` → creates a new version from the old content, same rules as any edit.
- [ ] Tests red: diff of nested object/array/added/removed keys; versions list ordered newest first with editor names; changes endpoint; restore creates version N+1 with old content and revokes sign-offs; trigger rejects `update` and `delete` on `wp_item_versions` as owner.
- [ ] Implement, green, commit.

### Task 2: Named users and the admin permission
**Files:** Migration 0013 (columns); `apps/api/src/tenants/routes.ts`, `apps/api/src/people/routes.ts`; authz policy and `roles.ts` (admin = `role === 'firm_admin' || isAdmin`); Tests in `apps/api/test/tenants.e2e.test.ts`, `packages/authz/test`.
**Interfaces:** invite body gains `fullName` (required, 2–120, at least two letters); `isAdmin?: boolean` honoured only for callers with admin permission. `/people` returns `{ id, fullName, email, role, grade }`. `isGenericMailbox(email: string): boolean` exported from `apps/api/src/people/names.ts`.
- [ ] Tests red: invite without a full name is 400; `admin@x`, `info@x`, `accounts@x` are 400 at invite and at `/platform/tenants`; an invited partner flagged `isAdmin` can use admin routes; a plain partner cannot; policy `tenant.admin` allows `firm_admin` role or `isAdmin`.
- [ ] Implement, green, commit.

### Task 3: Assignment-based client access and account manager
**Files:** Migration 0013 (`clients.account_manager_id`, `can_see_client`, policy swap); `apps/api/src/engagements/routes.ts` client routes; Tests `apps/api/test/client-access.e2e.test.ts`.
**Interfaces:** `can_see_client(p_client uuid) returns boolean` (partner, admin, account manager, or member of an engagement of the client). `POST /clients` body gains `accountManagerId` (default: the caller if manager or partner; must be an active manager or partner). `GET /clients` returns only visible clients with `accountManagerName`.
- [ ] Tests red: staff on an engagement sees that client only; unassigned staff gets an empty list and 404 on `GET /clients/:id`; partner and admin see all; manager sees the clients they manage or are a member of; creating a client with a staff-level account manager is 400.
- [ ] Implement, backfill existing rows to the first partner or manager of the tenant, green, commit.

### Task 4: Plain-English audit trail including views
**Files:** Migration 0013 (index; allow-list regex in `audit_append` to include `view`, `pii`); `apps/api/src/audit/{sentences.ts,views.ts,routes.ts}`; hook view logging into item, client, engagement, statements and evidence routes; Tests `apps/api/test/audit-sentences.test.ts`, `apps/api/test/audit-trail.e2e.test.ts`.
**Interfaces:** `describeEvent(e: AuditRow): string`; `recordView(req, tx, { type: 'client'|'engagement'|'paper'|'evidence'|'statements', id: string, label: string, clientName?: string, engagementId?: string }): Promise<void>` skips when the same actor, action and entity were logged within five minutes. `GET /audit-trail?user=&client=&action=&from=&to=&before=` → `{ events: { seq, at, actorName, sentence, client }[], next: number | null }`, partners and admins see everything, managers only events whose `detail.engagementId` is one of theirs, others 403.
- [ ] Tests red: sentence for each known action ("Jane Wanjiku viewed the engagement letter for Mwangaza Traders Ltd"); a second view within five minutes writes no new event; trail filters by user and date; staff get 403; the hash chain still verifies after view events.
- [ ] Implement, green, commit.

### Task 5: PII masking and logged reveal
**Files:** Migration 0013 (`client_contacts`); `apps/api/src/contacts/{mask.ts,routes.ts}`; Tests `apps/api/test/mask.test.ts`, `apps/api/test/contacts.e2e.test.ts`.
**Interfaces:** `maskPhone`, `maskEmail`, `maskId`, `maskPin` (pure, return strings that reveal at most the last 3 characters). Routes: `GET/POST /clients/:id/contacts`, `PATCH /clients/:id/contacts/:cid`, `POST /clients/:id/contacts/:cid/reveal { field: 'phone'|'email'|'idNumber'|'kraPin', reason }` → `{ value }` and writes `pii.revealed` with field and reason. Fields are encrypted with the existing `encrypt`.
- [ ] Tests red: masks for sample values; list returns only masked values; reveal without reason 400 and no event; reveal by unassigned staff 404 and no event; reveal by an assigned user returns the value and records the reason; database row holds no plaintext.
- [ ] Implement, green, commit.

### Task 6: Seed named people; web screens
**Files:** `apps/api/src/dev/seed.ts`, `demo-data.ts`; web `app/(app)/audit-trail/page.tsx`, `app/(app)/clients/[id]/page.tsx`, `components/History.tsx`, `ItemPanel.tsx`, `Nav.tsx`; e2e specs updated.
- [ ] Seed 14 named synthetic people with full names and personal-style emails (existing role-named users are migrated to them); firm admins carry the admin permission.
- [ ] Audit trail page with filters; client page with masked contacts and a reveal dialog asking for a reason; History panel on every paper with compare and restore.
- [ ] Typecheck, lint, e2e green; commit.

### Task 7: Verify and ship
- [ ] Full suite, e2e, lint, typecheck; push; list the new demo logins for the user.
