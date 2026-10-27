# Stage 4: account-manager handover, pipeline, calendar

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** A client always has an accountable manager who can be replaced when someone leaves; prospects are tracked from lead to client by the person who owns them; the firm has a shared calendar that shows partners and managers what their people are doing.

**Architecture:** Migration 0022 (handover: `client_reassign_manager`, `member_handover`, a guard in `admin_update_member`), 0023 (prospects), 0024 (calendar). Reassignment and handover are SECURITY DEFINER functions that write plain-English audit events with names as they were at the time. Prospects and calendar events have row-level security with visibility functions that read only memberships and engagement membership. The API adds `/clients/:id/account-manager`, `/admin/users/:id/handover`, `/prospects`, `/calendar`. The web adds a Pipeline page, a Calendar page (week view) and a hand-over panel on People and access. Help articles and the audit-trail sentences are extended.

**Spec:** `docs/superpowers/specs/2026-10-27-auditos-workflow-and-practice-management.md`

## Global Constraints
- A client's account manager is always an active manager or partner. A person who manages clients or owns open prospects cannot be switched off, or moved to a role that cannot manage, until they are handed over.
- Currency KES; fees as integer cents in the database and strings in JSON.
- Existing tests stay green; new behaviour has a test that was run before the code.

## Review Focus
- Reassigning removes the old manager's access to the client (unless they are on a team) and gives it to the new one.
- A prospect owned by one staff member is invisible to another staff member; partners and managers see all.
- A calendar event is invisible to people it does not concern; a manager sees events of people who share an engagement team with them.
- Converting a prospect twice never creates two clients.

### Task 1: Handover and reassignment
Files: migration 0022; `apps/api/src/people/handover.ts` (routes); tests `handover.e2e.test.ts`.
Interfaces: `POST /clients/:id/account-manager { userId, reason }` (partner or admin permission); `GET /admin/users/:id/handover` → `{ clients: {id,name}[], prospects: {id,name}[] }`; `POST /admin/users/:id/handover { toUserId, reason }` moves every client and open prospect; deactivation or role change away from manager/partner is refused (409 `has_responsibilities`) while any remain.
- [ ] Tests red first; implement; green; commit.

### Task 2: Pipeline
Files: migration 0023; `apps/api/src/pipeline/routes.ts`; tests `pipeline.e2e.test.ts`.
Interfaces: stages `lead | proposal | loe_sent | won | lost`; `GET /prospects`, `POST /prospects`, `PATCH /prospects/:id`, `POST /prospects/:id/stage { stage, reason? }`, `POST /prospects/:id/owner { userId, reason }`, `POST /prospects/:id/convert { accountManagerId?, legalForm, yearEndMonth, framework? }` → creates the client once, marks the prospect won.
- [ ] Tests red first; implement; green; commit.

### Task 3: Calendar
Files: migration 0024; `apps/api/src/calendar/routes.ts`; tests `calendar.e2e.test.ts`.
Interfaces: `GET /calendar?from&to&person?` returns stored events plus engagement milestones (period end, report date, lock deadline); `POST /calendar`, `PATCH /calendar/:id`, `POST /calendar/:id/cancel`.
- [ ] Tests red first; implement; green; commit.

### Task 4: Web, help, audit sentences, demo data, e2e
- [ ] Pipeline page, Calendar page, hand-over panel, client page reassign control; Help links and articles; sentences for the new audit events; seed demo prospects and calendar events; browser specs.

### Task 5: Verify and ship
- [ ] Full tests, typecheck, lint, production build, browser suite; push.
