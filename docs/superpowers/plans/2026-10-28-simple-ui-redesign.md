# Simple UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the whole AuditOS web app one calm, familiar design language in Inter: a grouped menu with a Today home page, a table-first Pipeline, an Outlook-style Calendar, and every other screen brought in line with six shared rules.

**Architecture:** Presentation only. A small set of shared UI primitives (`apps/web/components/ui`) and pure logic modules (`apps/web/lib`) are built first with unit tests; screens are then rebuilt on them, one task per screen group, each with its Playwright spec updated. No API, permission or database changes.

**Tech Stack:** Next.js 15 (App Router, client pages), React 19, plain CSS in `apps/web/app/globals.css`, `next/font/google` (Inter), Vitest for `apps/web/test`, Playwright for `e2e/tests`.

**Spec:** [docs/superpowers/specs/2026-10-28-simple-ui-redesign-design.md](../specs/2026-10-28-simple-ui-redesign-design.md)

## Global Constraints

- Presentation only: no change to who can see or do what; no API, database or permission changes. A new API read is allowed only if an existing endpoint cannot supply a Today row, and it must reuse the same access checks.
- Font: **Inter** for body and headings, loaded with `next/font` (self-hosted at build, no runtime font CDN). The CSP in `apps/web/middleware.ts` already allows only `font-src 'self'`; do not loosen it.
- Colours stay the existing tokens in `globals.css` (`--paper`, `--sheet`, `--ink`, `--pencil`, `--rule`, `--ledger*`, `--red-pen`, `--amber*`). No new palette, no logo change.
- Six rules on every screen: (1) one green main action, top right; (2) forms open in a side panel from that button; (3) lists are tables with search and one-click filters, click a row for details; (4) row actions in one "..." menu with plain-word names; (5) each page opens with one sentence and has a plain-English empty state; (6) accountants' words, readable text, white space.
- Plain words everywhere: no software terms in anything a person reads (page text, buttons, labels, errors, empty states, help articles, sign-in steps). The replacement table and the banned-word list are in the spec's "Plain words" section; `lib/plain.ts` (Task 2A) holds the list and every screen task obeys it. "Pipeline" is renamed "Prospects" in all visible text (the `/pipeline` address and the `dashboard` help topic id stay).
- Menu order and names are fixed by the spec: Today; My work (Calendar, Timesheet); Clients and audits (Clients, Engagements); Business (Prospects, Billing); Firm (Quality and independence, People); Help. At most five headings and eight links for any role.
- Every action that exists today stays reachable in at most two clicks.
- Keyboard operable: menu, accordion and side panel work with keyboard; Escape closes a panel or menu and focus returns to the control that opened it; visible focus; colour is never the only signal.
- Targets: laptop width 1280px; no clipped or unreachable controls at tablet width (768px). Phone layout out of scope.
- Calendar stays on the existing `GET /calendar` endpoint and the `Africa/Nairobi` time zone.
- Existing URLs keep working. Merged pages (Billing, Quality) keep their current routes and gain a shared tab bar, so no redirects are needed.
- Help articles and Playwright specs that mention changed screens are updated in the same task that changes the screen. Help topic ids (for example `dashboard`) are not renamed.
- Per-user view preferences (Pipeline Table/Cards, Calendar view) are stored in browser storage, wrapped in try/catch, and the page must work with storage unavailable.
- Commit after each task. Run `pnpm --filter @auditos/web typecheck` and `pnpm --filter @auditos/web test` before every commit; run the named Playwright specs for tasks that change screens (`pnpm --filter @auditos/e2e e2e tests/<file>`).

## Review Focus

- Pipeline with 0 prospects, 1 prospect and 40 prospects: empty state, no layout break, search with no match shows "No prospects match", filters combine (stage + person + search).
- A prospect with no fee, no start date, no sector, no contact and very long notes or name: row and card render without overflow or "null"/"NaN".
- Calendar: an event that spans midnight or several days, an all-day event, two overlapping events, and an event at 23:30 Nairobi time land on the correct days and do not overlap visually.
- Calendar day with 0 events and a day with 12 events: Month cell shows nothing or "12 events" with at most 6 dots, never overflows the cell.
- Browser storage unavailable or holding a corrupt value for a saved view: page falls back to the default view without throwing.
- Role checks: staff never see "See by person", billing tabs a role cannot use, or the pipeline for administrators; the firm administrator still has no Today rows and no scheduling.
- Escape and focus return on the side panel and "..." menu; a row menu opened near the bottom of the viewport stays fully visible.

---

## File Structure

New:
- `apps/web/components/ui/SidePanel.tsx`, `RowMenu.tsx`, `Chips.tsx`, `Segmented.tsx`, `Disclosure.tsx`, `PageHead.tsx`, `TabBar.tsx`, `EmptyState.tsx`: shared primitives.
- `apps/web/lib/prefs.ts`: `readPref`/`writePref` and the `usePref` hook.
- `apps/web/lib/pipeline.ts`: pure filtering and counting for prospects.
- `apps/web/lib/calendar.ts`: pure date, grouping and layout logic for the calendar.
- `apps/web/lib/nav.ts`: pure menu definition by role.
- `apps/web/lib/today.ts`: pure Today rows by role.
- `apps/web/components/ProspectTable.tsx`, `ProspectCards.tsx`, `ProspectPanel.tsx`: pipeline pieces.
- `apps/web/components/calendar/MonthView.tsx`, `TimeGrid.tsx`, `DayPanel.tsx`, `PersonColumns.tsx`, `MiniMonth.tsx`, `EventForm.tsx`: calendar pieces.
- `apps/web/components/BillingTabs.tsx`, `QualityTabs.tsx`: shared tab bars.
- `apps/web/lib/plain.ts`: the banned-word list and `findJargon(text: string): string[]`.
- `apps/web/test/prefs.test.ts`, `pipeline.test.ts`, `calendar.test.ts`, `nav.test.ts`, `today.test.ts`, `plain.test.ts`.
- `e2e/tests/design.spec.ts`: font and shared-primitive behaviour. `e2e/tests/plain-words.spec.ts`: visits every page and checks for banned words.

Modified: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/components/Nav.tsx`, `apps/web/components/bits.tsx`, `apps/web/app/(app)/page.tsx` (becomes Today), every page under `apps/web/app/(app)` and `apps/web/app/login`, `apps/web/app/accept-invite`, `e2e/helpers.ts`, existing `e2e/tests/*.spec.ts`, `packages/help/content/*.ts`, `README.md`.

---

### Task 1: Inter and the type scale

**Files:**
- Modify: `apps/web/app/layout.tsx`, `apps/web/app/globals.css` (`:root` tokens, `h1,h2,h3`, `.tile-value`, `.rail .brand`, `.ref`, `.stamp .initials`, `table.ledger .group td`)
- Create: `e2e/tests/design.spec.ts`

**Interfaces:**
- Produces: CSS variable `--sans` resolving to Inter; `--serif` removed and every use switched to `--sans`; body 16px, headings Inter 600 with the existing sizes.

- [ ] **Step 1: Write the failing spec** `design.spec.ts` test `'uses Inter everywhere'`: sign in as `grace.kangethe@kangethe.example.test`, open `/`, assert `getComputedStyle(document.body).fontFamily` and the `h1` font family both start with `Inter`, and that `document.fonts.check('16px Inter')` is true.
- [ ] **Step 2: Run** `pnpm --filter @auditos/e2e e2e tests/design.spec.ts`. Expected: FAIL (Segoe UI).
- [ ] **Step 3: Implement** `const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })` in `layout.tsx`, put `inter.variable` on `<html>`, set `--sans: var(--font-inter), system-ui, ...` and delete `--serif` and `--font-serif` usages (grep `serif` in `apps/web`). Keep `font-variant-numeric: tabular-nums` on body. If `next build` cannot reach Google Fonts in the build environment, use `next/font/local` with `@fontsource-variable/inter` instead and say so in the commit message.
- [ ] **Step 4: Run** the spec again, then `pnpm --filter @auditos/web exec next build`. Expected: PASS, build succeeds, no `serif` left in `apps/web`.
- [ ] **Step 5: Commit** `feat(web): Inter as the typeface`.

### Task 2: Shared UI primitives and saved preferences

**Files:**
- Create: the eight files in `apps/web/components/ui/`, `apps/web/lib/prefs.ts`, `apps/web/test/prefs.test.ts`
- Modify: `apps/web/app/globals.css` (add primitive styles; keep every existing class)

**Interfaces:**
- Produces (exact):
  - `readPref<T>(key: string, fallback: T, storage?: Pick<Storage,'getItem'>): T`, `writePref(key: string, value: unknown, storage?: Pick<Storage,'setItem'>): void`, `usePref<T>(key: string, fallback: T): [T, (v: T) => void]`. Keys are prefixed `aos:`. Any storage error or JSON error returns the fallback.
  - `<SidePanel open title onClose children />`: right-hand dialog (`role="dialog" aria-modal`), Escape and backdrop click close it, focus moves in on open and returns to the opener on close.
  - `<RowMenu label items />` with `items: { label: string; onSelect: () => void; danger?: boolean; hidden?: boolean }[]`: a "..." button (`aria-haspopup="menu"`, accessible name from `label`, e.g. "Actions for Kito Logistics Ltd"), arrow keys move, Escape closes, flips upward near the viewport bottom.
  - `<Chips value onChange options />` with `options: { id: string; label: string; count?: number; hint?: string }[]`, rendered as buttons with `aria-pressed`.
  - `<Segmented value onChange options />` with `options: { id: string; label: string }[]` (radio-group semantics).
  - `<Disclosure summary open? onToggle? children />`: button with `aria-expanded` controlling its panel.
  - `<PageHead title sentence action? help? />`: `h1`, one sentence, the single green main action on the right, optional `<HelpLink>`.
  - `<TabBar tabs current />` with `tabs: { href: string; label: string; show: boolean }[]`, link-based, `aria-current="page"` on the current one.
  - `<EmptyState title? children action? />`.

- [ ] **Step 1: Write failing tests** in `prefs.test.ts`: `readPref` returns the fallback when storage throws, when the stored text is not valid JSON, and when the key is missing; returns the stored value otherwise; `writePref` does not throw when `setItem` throws; keys are written as `aos:<key>`.
- [ ] **Step 2: Run** `pnpm --filter @auditos/web test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `prefs.ts` and the primitives. `usePref` must read after mount (not during render) so server and client markup match.
- [ ] **Step 4: Run** the web tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): shared panel, menu, chips, switch, disclosure, page head and tab bar`.

(Primitive behaviour is exercised end to end by the Pipeline and Calendar specs in Tasks 4, 6 and 7; do not add a throwaway page for them.)

### Task 2A: Plain-words guard and the shared error messages

**Files:**
- Create: `apps/web/lib/plain.ts`, `apps/web/test/plain.test.ts`
- Modify: `apps/web/lib/text.ts` (export `MESSAGES`; reword the entries and the fallback in `explain`; rename `Audit trail` and `Locked` wording only where the spec table says so)

**Interfaces:**
- Produces: `BANNED_WORDS: RegExp[]` (authenticator, outbox, `simulat\w*`, session, csrf, malware, quarantin\w*, fingerprint, sha-?256, tenant, token, payload, `\bapi\b`, `\bmfa\b`, `\btotp\b`, case-insensitive) and `findJargon(text: string): string[]` returning the distinct matched words.
- Consumes later: every screen task and the final sweep call `findJargon` through `plain-words.spec.ts`; `explain()` fallback becomes "Something went wrong. Please try again. If it keeps happening, tell your administrator (reference: <code>)."

- [ ] **Step 1: Write failing tests** `plain.test.ts`: `findJargon('Enter the code from your authenticator app')` returns `['authenticator']`; plain sentences return `[]`; matching ignores case and does not flag "capital" or "rapid" (word-boundary cases for `api`); **every value of `MESSAGES` returns `[]`** (this fails today on `unauthenticated`, `csrf`, `quarantined`); `explain(new ApiError(...unknown code...))` contains "reference:" and no banned word.
- [ ] **Step 2: Run** `pnpm --filter @auditos/web test`. Expected: FAIL.
- [ ] **Step 3: Implement** `plain.ts`; reword `MESSAGES` per the spec table ("You have been signed out. Sign in again.", "Please reload the page.", "That file failed the virus check and cannot be downloaded.").
- [ ] **Step 4: Run** tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): plain-words guard; rewrite error messages without software terms`.

### Task 3: Pipeline logic

**Files:**
- Create: `apps/web/lib/pipeline.ts`, `apps/web/test/pipeline.test.ts`

**Interfaces:**
- Produces: `type Stage = 'lead'|'proposal'|'loe_sent'|'won'|'lost'`; `interface ProspectFilter { stage: 'open'|Stage; ownerId: string; query: string }`; `filterProspects<P extends { name: string; ownerId: string; ownerName: string; stage: Stage; contactName: string|null }>(rows: P[], f: ProspectFilter): P[]` (`'open'` means lead, proposal and loe_sent; `ownerId ''` means everyone; `query` matches name, owner name or contact name, case-insensitive, trimmed); `countByStage(rows): Record<Stage, number>`; `STAGE_LABELS: Record<Stage,string>` ("Lead", "Proposal sent", "Engagement letter sent", "Won", "Lost").

- [ ] **Step 1: Write failing tests**: `'open' excludes won and lost`; stage filter `proposal` returns only proposals; owner filter; query matches owner name `'daniel'` and contact `'josephine'`, ignores case and surrounding spaces; empty query and `ownerId ''` return all of the stage; no match returns `[]`; `countByStage` counts each stage including zeros.
- [ ] **Step 2: Run** the web tests. Expected: FAIL.
- [ ] **Step 3: Implement** the module (pure, no React).
- [ ] **Step 4: Run** tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): pipeline filtering logic`.

### Task 4: Pipeline page

**Files:**
- Create: `apps/web/components/ProspectTable.tsx`, `ProspectCards.tsx`, `ProspectPanel.tsx`
- Modify: `apps/web/app/(app)/pipeline/page.tsx` (rewrite using the new components; keep every API call, field and validation of the current page), `e2e/tests/practice.spec.ts`

**Interfaces:**
- Consumes: Task 2 primitives, Task 3 `filterProspects`/`countByStage`/`STAGE_LABELS`.
- Produces: `<ProspectTable rows actions />` and `<ProspectCards rows actions />` where `actions: { move(p, stage), lose(p), handOver(p), convert(p) }`; `<ProspectPanel mode: 'add'|'lost'|'handover'|'convert' prospect? onDone />` holding the existing forms (Add a prospect, Why was it lost, Hand over with reason, Make a client with legal form, year end and account manager).

- [ ] **Step 1: Update `practice.spec.ts` first** so it describes the new page and fails: the page heading and menu link read "Prospects" (not "Pipeline"; the address stays `/pipeline`); Daniel (manager) sees the table, the chips "Lead 3", the person filter instead of the `By person:` line, "Pwani Fisheries Ltd" row; Brian (staff) has no person filter; admin still has no Pipeline link; clicking "+ Add a prospect" opens a dialog and Escape closes it with focus back on the button; the `Table`/`Cards` switch shows stage sections and survives a reload (saved preference); typing a non-matching search shows "No prospects match"; a row's "..." menu offers "Move to Proposal sent", "Hand over", "Make a client" for managers and not "Hand over"/"Make a client" for staff.
- [ ] **Step 2: Run** `pnpm --filter @auditos/e2e e2e tests/practice.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the spec's Pipeline section: `PageHead` with the "+ Add a prospect" action; `Chips` (All open, Lead, Proposal sent, Engagement letter sent, with counts, plus Won and Lost counts shown as plain text); person filter `<select>` for managers and partners only; search input; `Segmented` Table/Cards saved with `usePref('pipeline.view','table')`; table columns Prospect, Stage, Fee, Expected start, Owner, `RowMenu`; row click expands (`Disclosure`) to sector, contact, notes; cards view groups into collapsible stage sections each showing count and total (use `summary.byStage` from the API for totals); Closed section stays below, collapsed. Fee text "No fee yet" and date formatting reuse `kes` and `fmtDate` from the current page.
- [ ] **Step 4: Run** the spec, typecheck and web tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): pipeline as a table with a cards view, filters and a side panel`.

### Task 5: Calendar logic

**Files:**
- Create: `apps/web/lib/calendar.ts`, `apps/web/test/calendar.test.ts`

**Interfaces:**
- Produces (exact), all pure, all using Nairobi days:
  - `dayOf(iso: string): string` (`YYYY-MM-DD`), `timeOf(iso: string): string` (`HH:mm`), `addDays(date: string, n: number): string`, `mondayOf(date: string): string` (moved from the current page).
  - `eventsOnDay<E extends { startsAt: string; endsAt: string }>(events: E[], day: string): E[]` (a multi-day event appears on every day it covers; an event ending exactly at 00:00 does not appear on that next day).
  - `peopleOf(e: { createdBy: string; createdByName: string; attendees: { id: string; name: string }[] }): { id: string; name: string }[]` (creator first, then attendees, no duplicates).
  - `groupByPerson(events, day, meId: string): { id: string; name: string; isMe: boolean; events: E[] }[]` (the signed-in person first when present, the rest alphabetical by name).
  - `monthGrid(anchor: string): string[][]` (weeks Monday to Sunday covering the month of `anchor`).
  - `layoutDay<E extends { startsAt: string; endsAt: string }>(events: E[]): { event: E; col: number; cols: number; top: number; height: number }[]` (`top` and `height` as minutes from 00:00 within the day, clipped to the day; overlapping events share equal columns).
  - `KIND_STYLES: Record<string, { label: string; token: string; icon: string }>` for meeting, fieldwork, deadline, leave, training, other (icon is a text glyph so colour is never the only signal).

- [ ] **Step 1: Write failing tests**: `dayOf('2026-11-03T20:30:00Z')` is `2026-11-03` and `dayOf('2026-11-03T21:30:00Z')` is `2026-11-04` (Nairobi is UTC+3); a Mon-to-Wed leave event appears on three days and an event ending at `00:00` the next day does not appear on it; `groupByPerson` puts `meId` first, includes attendees, never lists a person twice; `monthGrid('2026-11-15')` starts on Monday `2026-10-26`, every row has 7 days; `layoutDay` gives two overlapping events `cols: 2` and distinct `col`, and two back-to-back events `cols: 1`; an event from 22:00 to the next day 02:00 is clipped to 22:00-24:00 on the first day.
- [ ] **Step 2: Run** web tests. Expected: FAIL.
- [ ] **Step 3: Implement** the module; no React. Take the existing helpers from `calendar/page.tsx` and delete them there in Task 6.
- [ ] **Step 4: Run** tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): calendar date, grouping and overlap logic`.

### Task 6: Calendar, month view and day panel

**Files:**
- Create: `apps/web/components/calendar/MonthView.tsx`, `DayPanel.tsx`, `MiniMonth.tsx`, `EventForm.tsx`
- Modify: `apps/web/app/(app)/calendar/page.tsx`, `e2e/tests/practice.spec.ts`

**Interfaces:**
- Consumes: Task 2 primitives, Task 5 `calendar.ts`.
- Produces: `<MonthView days events milestones selected onSelect meId />`, `<DayPanel day events milestones meId onEdit onCancel />`, `<MiniMonth anchor selected onPick />`, `<EventForm editing? defaults onDone />` (the current form's fields, validation and request bodies unchanged, hosted in `SidePanel`).

- [ ] **Step 1: Update the calendar test in `practice.spec.ts`** and add a busy-day test; they fail first: opens on Month; toolbar has Today, previous, next and the Day / Work week / Week / Month switch; Brian sees "Fieldwork: Mwangaza stock count" in the day panel but not the Savannah meeting; Tom sees only his leave; Grace's day panel lists people as folded accordions with her own open; a day with several people shows "N events" in its cell; "+ New event" opens a dialog (Escape closes, focus returns); Edit and Cancel appear only on events the person created; milestones show as diamonds and have no Edit or Cancel.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** the Month view per the spec: `MonthView` cells show at most one summary ("N events") and up to 6 person dots with `title` and `aria-label`, selected and today highlighted; clicking a cell sets `selected` and fills `DayPanel`; `DayPanel` uses `groupByPerson` with `Disclosure` per person (signed-in person open) and `Disclosure` per event for details, Edit and Cancel; the colour legend (`KIND_STYLES`) doubles as show/hide `Chips`; partners and managers keep the "Show" person select. Persist the view with `usePref('calendar.view','month')`. The page still calls `/calendar?from=&to=` with the visible month's first and last grid day.
- [ ] **Step 4: Run** the spec, typecheck and tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): calendar month view with a day panel grouped by person`.

### Task 7: Calendar, time grids and "See by person"

**Files:**
- Create: `apps/web/components/calendar/TimeGrid.tsx`, `PersonColumns.tsx`
- Modify: `apps/web/app/(app)/calendar/page.tsx`, `e2e/tests/practice.spec.ts`

**Interfaces:**
- Consumes: Task 5 `layoutDay`, `groupByPerson`, `peopleOf`.
- Produces: `<TimeGrid days events meId />` (Work week shows Monday-Friday; Week shows 7 days; Day shows one; all-day and multi-day events sit in a strip above the hours; hours 07:00-19:00 visible by default and scrollable to the full day); `<PersonColumns day events meId />` (one column per person in `groupByPerson`, shared hour grid).

- [ ] **Step 1: Extend the spec** (fails first): Work week and Week render hour labels and an event block for Grace's "Management meeting"; an all-day leave shows in the strip, not on the grid; Grace (partner) sees "See by person" and gets one column per person with the correct names; Brian (staff) does not see it; two overlapping events render side by side (their bounding boxes do not intersect).
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** the components with absolutely positioned blocks from `layoutDay` (minute offsets to pixels with a single `PX_PER_MINUTE` constant). Each block shows kind icon, time and title, and uses the kind colour as its left border and a tint as fill. "See by person" and the Day view's person-columns toggle render only for partner and manager.
- [ ] **Step 4: Run** the spec, typecheck and tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): calendar work week, week and day views with see-by-person`.

### Task 8: Grouped menu and shared tab bars

**Files:**
- Create: `apps/web/lib/nav.ts`, `apps/web/test/nav.test.ts`, `apps/web/components/BillingTabs.tsx`, `QualityTabs.tsx`
- Modify: `apps/web/components/Nav.tsx`, `apps/web/app/globals.css` (group headings), `apps/web/app/(app)/billing/page.tsx`, `billing/outbox/page.tsx`, `billing/settings/page.tsx`, `invoices/page.tsx`, `invoices/[id]/page.tsx`, `invoices/new/page.tsx`, `quotes/page.tsx`, `quotes/[id]/page.tsx`, `quotes/new/page.tsx`, `independence/page.tsx`, `audit-trail/page.tsx` (render the tab bar at the top of each), `e2e/tests/trust.spec.ts`, `visibility.spec.ts`, `billing.spec.ts`

**Interfaces:**
- Produces: `interface NavItem { href: string; label: string }`, `interface NavGroup { heading: string | null; items: NavItem[] }`, `navFor(role: string, isAdmin: boolean): NavGroup[]`. Groups, in this order: Today (`heading: null`, `/`, "Today", not for `firm_admin`); "My work" (Calendar `/calendar`, Timesheet `/timesheet`); "Clients and audits" (Clients `/clients`, Engagements `/engagements`); "Business" (Prospects `/pipeline`, Billing `/billing`); "Firm" ("Quality and independence" `/independence`, "People" `/admin/users`); Help (`heading: null`, `/help`). Visibility is exactly today's rules from `Nav.tsx` (`admin`, `holdsAdmin`, `seesTrail`, `works`, `billing`). Empty groups are omitted; no role gets more than five headings or eight links. `billingTabs(role, isAdmin)` and `qualityTabs(role, isAdmin)` return `TabBar` tab lists: Billing = Overview `/billing`, Invoices `/invoices`, Quotations `/quotes`, Outbox `/billing/outbox`, Settings `/billing/settings` (same role gates as today); Quality = Independence `/independence`, Audit trail `/audit-trail` (audit trail only for `seesTrail`).

- [ ] **Step 1: Write failing tests** `nav.test.ts`: for each of the seven roles (and `firm_admin` with and without `isAdmin`) assert the exact heading and href list, mirroring the current `Nav.tsx` conditions (for example staff: Today; My work: Calendar, Timesheet; Clients and audits: Clients, Engagements; Business: Prospects; Firm: Quality and independence; Help; `firm_admin`: Clients and audits: Clients; Business: Billing; Firm: Quality and independence, People; Help; no Today, no Prospects); no group is empty; no role exceeds five headings or eight links; `billingTabs('staff', false)` is `[]`; `qualityTabs('senior', false)` has no Audit trail.
- [ ] **Step 2: Run** web tests. Expected: FAIL.
- [ ] **Step 3: Implement** `nav.ts`, render `Nav` from `navFor` with group headings and `aria-current`, add the tab bars to the pages listed (the active tab follows the URL prefix; the "Billing" menu item is current on every billing, invoices and quotes route; "Quality and independence" is current on `/independence` and `/audit-trail`). The "Audit trail" tab and page title become "Activity history". Update the three specs: menu links by group, nav item names ("Today", "Calendar", "Timesheet", "Clients", "Engagements", "Prospects", "Billing", "Quality and independence", "People").
- [ ] **Step 4: Run** `pnpm --filter @auditos/e2e e2e tests/trust.spec.ts tests/visibility.spec.ts tests/billing.spec.ts`, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): grouped menu and shared Billing and Quality tab bars`.

### Task 9: Today page

**Files:**
- Create: `apps/web/lib/today.ts`, `apps/web/test/today.test.ts`
- Modify: `apps/web/app/(app)/page.tsx` (becomes Today), `e2e/helpers.ts` (`signIn` accepts landing on `/` or `/clients`), `packages/help/content/getting-started.ts`, `packages/help/content/review-and-approval.ts`

**Interfaces:**
- Consumes: `GET /dashboard` (`awaitingReview`, `myDrafts`, `openNotes`), `GET /billing/summary` (`overdue: { count, total }`, billing roles only), `GET /calendar` milestones for the next 14 days, `GET /me`.
- Produces: `interface TodayRow { id: string; tone: 'action' | 'warn'; text: string; href: string }` and `buildToday(input: { role: string; isAdmin: boolean; awaitingReview: {id:string;title:string;engagementId:string;clientName:string;level:string}[]; myDrafts: {id:string;title:string;engagementId:string;clientName:string}[]; openNotes: number; overdue?: { count: number; total: string }; milestones: { date: string; title: string; engagementId: string }[]; today: string }): TodayRow[]`. Rows by role per the spec: awaiting review (manager, partner, eqr), drafts and open notes (partner, manager, senior, staff), overdue invoices (when `overdue.count > 0`), milestones within 14 days of `today`, ordered action rows first then warnings. `firm_admin` gets `[]`.

- [ ] **Step 1: Write failing tests** `today.test.ts`: a manager with two papers waiting gets two action rows linking to `/engagements/<id>?tab=papers&item=<paper id>`; staff gets no review rows; `overdue.count 0` yields no invoice row and `count 2` yields one row saying "2 invoices are overdue (KES …)" linking to `/invoices`; a milestone 6 days away is included and one 20 days away is not; `firm_admin` returns `[]`; an empty input returns `[]`.
- [ ] **Step 2: Run** web tests. Expected: FAIL.
- [ ] **Step 3: Implement** `buildToday`, then the page: greeting by name and time of day, one sentence, the existing `WhatYouSee` panel kept below the list, rows as `todo` cards with an "Open" link, an `EmptyState` ("Nothing needs you today. Enjoy the quiet.") when empty, and "Your engagements" kept as a compact table. `firm_admin` is redirected to `/clients` with `router.replace`. Replace the "Dashboard" wording in the two help articles with "Today" and keep the `dashboard` topic id.
- [ ] **Step 4: Run** the full Playwright suite (`pnpm --filter @auditos/e2e e2e`), `pnpm --filter @auditos/help test`, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Today page replaces the dashboard`.

### Task 10: Sign-in, invitation and firm selection

**Files:**
- Modify: `apps/web/app/login/page.tsx`, `apps/web/app/accept-invite/page.tsx`, `e2e/tests/trust.spec.ts` (only if selectors change)

- [ ] **Step 1: Write the failing check** in `design.spec.ts`: the sign-in page shows the AuditOS name, exactly one primary button per step ("Continue", "Sign in"), a one-sentence description under each heading, and the firm choice step lists firms as large selectable rows; the 5-failure lock message and generic error text are unchanged.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement**: restyle to the shared tokens, larger inputs and buttons, step text in plain words per the spec table ("Set up your sign-in code": add the setup code to a code app on your phone, then type the 6-digit code; "Enter your code": the 6-digit code from your phone; "Setup code" and "Can't scan? Use this link"), and the same wording in `components/StepUp.tsx` ("This is recorded in the activity history. Enter the 6-digit code from your phone."), no behaviour change (field ids `email`, `password`, `code` stay, since `e2e/helpers.ts` uses them).
- [ ] **Step 4: Run** the spec plus `trust.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): calmer sign-in, invitation and firm selection`.

### Task 11: Clients

**Files:**
- Modify: `apps/web/app/(app)/clients/page.tsx`, `apps/web/app/(app)/clients/[id]/page.tsx`, `e2e/tests/visibility.spec.ts`, `e2e/tests/practice.spec.ts`

- [ ] **Step 1: Update specs first**: clients list is a table with a search box and a "+ Add a client" button opening a side panel; each row links to the client; on the client page "Change the account manager" and "Add a contact" open in side panels from buttons (heading text "Change the account manager" keeps its exact text inside the panel); revealing a contact's personal details keeps its confirm-and-record step; partners see the change-manager button, managers do not.
- [ ] **Step 2: Run** the specs. Expected: FAIL.
- [ ] **Step 3: Implement** with `PageHead`, `SidePanel`, `RowMenu` (Reveal, Edit where it exists today), `EmptyState`. Keep all requests and masking exactly as now.
- [ ] **Step 4: Run** `visibility.spec.ts` and `practice.spec.ts`, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): clients list and client page on the shared patterns`.

### Task 12: Engagements and the engagement tabs

**Files:**
- Modify: `apps/web/app/(app)/engagements/page.tsx`, `engagements/[id]/page.tsx`, `engagements/[id]/tabs/Overview.tsx`, `Papers.tsx`, `Checklists.tsx`, `Evidence.tsx`, `Financials.tsx`, `Materiality.tsx`, `BankStatements.tsx`, `Sampling.tsx`, `apps/web/components/ItemPanel.tsx`, `Roadmap.tsx`, `History.tsx`, `FeeCard.tsx`, `e2e/tests/review-flow.spec.ts`, `audit-work.spec.ts`, `roadmap.spec.ts`

- [ ] **Step 1: Update specs first** (fail): engagements list is a table with search, a stage filter chip row and "+ Open an engagement" (side panel); the engagement page keeps its eight tabs (same names and `?tab=` values) restyled with the shared `TabBar` look; sign-off, review, approve and lock flows, bank statement upload and sampling keep their button names; one primary action per tab.
- [ ] **Step 2: Run** the three specs. Expected: FAIL.
- [ ] **Step 3: Implement**: reword Evidence upload messages ("Saved and checked", "failed the virus check") and the Risk flags hint ("hold the engagement back until they are done"); list page like Clients; engagement tab strip restyled in place (it is button-based with `role="tab"` today, keep that markup and `aria-selected`); each tab's forms that sit above lists move behind one main button into a side panel (Evidence upload, Materiality settings stay inline since they are single forms, call this out in the commit message); sign-off stamps, ledger tables and `FeeCard` keep their markup and only pick up the new type and spacing. Do not change statement or sampling logic.
- [ ] **Step 4: Run** the three specs, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): engagements and engagement tabs on the shared patterns`.

### Task 13: Timesheet

**Files:**
- Modify: `apps/web/app/(app)/timesheet/page.tsx`, `e2e/tests/billing.spec.ts`

- [ ] **Step 1: Update the timesheet part of `billing.spec.ts`** (fails first): week toolbar with Today and previous/next (names "Previous week", "Next week" kept), "+ Log time" and "+ Record expense" open side panels, week totals shown above the table, delete moves into the row menu named "Delete".
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** with the shared primitives; keep rates hidden from staff exactly as now.
- [ ] **Step 4: Run** the spec, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): timesheet on the shared patterns`.

### Task 14: Billing, invoices and quotations

**Files:**
- Modify: `apps/web/app/(app)/billing/page.tsx`, `billing/settings/page.tsx`, `billing/outbox/page.tsx`, `invoices/page.tsx`, `invoices/[id]/page.tsx`, `invoices/new/page.tsx`, `quotes/page.tsx`, `quotes/[id]/page.tsx`, `quotes/new/page.tsx`, `apps/web/components/billing.tsx`, `packages/help/content/billing.ts`, `e2e/tests/billing.spec.ts`

- [ ] **Step 1: Update `billing.spec.ts`** (fails first): Overview shows the tiles then the By engagement and By person tables; Invoices and Quotations lists are tables with a status chip filter and search and a "+ New invoice" / "+ New quotation" main button; clicking a row opens the document page; Daniel (manager) sees Mwangaza's issued invoice marked SIMULATION and not Ruth's draft; Grace can issue and record a payment; Wanjiru sees invoicing but not hours; every tab of the bar is reachable by keyboard.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement**: lists as tables with chips; document pages (`invoices/[id]`, `quotes/[id]`) keep their layout with actions (Issue, Record payment, Send) in a quiet row plus a "..." menu for the rest; `invoices/new` and `quotes/new` stay full pages because they build multi-line documents (note this exception in the commit message); settings page sections become collapsible `Disclosure` blocks (Rates, Taxes, Invoice details) each with its own Save. The warning banner stays on every practice document and reads "PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice"; the list tag reads "practice". The Outbox page and tab become "Sent emails" ("Not actually sent (practice mode)"). Update the billing help article text for the tab bar and these words, and update `billing.spec.ts` selectors (SIMULATION becomes PRACTICE ONLY).
- [ ] **Step 4: Run** the spec, `pnpm --filter @auditos/help test`, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): billing, invoices and quotations on the shared patterns`.

### Task 15: Firm pages and Help

**Files:**
- Modify: `apps/web/app/(app)/independence/page.tsx`, `audit-trail/page.tsx`, `admin/users/page.tsx`, `help/page.tsx`, `help/[id]/page.tsx`, `apps/web/components/WhatYouSee.tsx`, `StepUp.tsx`, `HelpLink.tsx`, `Markdown.tsx`, `e2e/tests/trust.spec.ts`, `isolation.spec.ts`, `help.spec.ts`

- [ ] **Step 1: Update specs first** (fail): Independence has "+ Make a declaration" (side panel) and a table of declarations; the page titled "Activity history" (was Audit trail) keeps "Show older" and gains search and an action-type filter; People has "+ Invite someone" (side panel) and a table with a row menu holding "Pause access" or "Restore access" (were Switch off and Switch on) and "Hand over"; the client page's "Reveal and record" becomes "Show details (this is recorded)" (update `visibility.spec.ts` and `practice.spec.ts` selectors that use the old names); the step-up dialog keeps its behaviour; Help keeps search, "For the page you were on" and categories as `Disclosure` sections.
- [ ] **Step 2: Run** the three specs. Expected: FAIL.
- [ ] **Step 3: Implement** with the shared primitives; the `StepUp` modal keeps its markup and uses the same focus rules.
- [ ] **Step 4: Run** the three specs, `pnpm --filter @auditos/help test`, typecheck, tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): quality, people, audit trail and help on the shared patterns`.

### Task 16: Plain-words sweep, final pass and documentation

**Files:**
- Create: `e2e/tests/plain-words.spec.ts`
- Modify: `README.md` (demo guide: menu groups, Today, Prospects table, Calendar views, new names), `packages/help/content/*.ts` (every article that names a renamed page or uses a banned word), `packages/help/test/content.test.ts` (add the banned-word check over article bodies and titles), `apps/web/app/globals.css` (remove dead classes such as `.board`, `.week`, `.day`, `.event` once unused; keep print rules)

- [ ] **Step 1: Write the failing sweep** `plain-words.spec.ts`: for each of Grace (partner), Daniel (manager), Brian (staff) and Wanjiru (administrator), visit every link in their menu plus the sign-in steps, one client, one engagement and each of its tabs, and assert no banned word appears in `await page.locator('body').innerText()` (e2e cannot import from the web app, so keep a copy of the list in `e2e/helpers.ts`); also assert the menu has the exact headings and order from the spec and at most five headings and eight links.
- [ ] **Step 2: Run it** and fix every hit it reports in the screen's file or in the help articles (use the spec's replacement table; for a term not in the table, choose the plain word and add a row to the table). Re-run until it passes.
- [ ] **Step 3: Check for dead styles and stale text**: grep `apps/web` for `className="board"`, `week`, `day`, `event` and for the words "Dashboard", "Pipeline", "By person:", "Add a prospect", "Audit trail", "Outbox", "SIMULATION" in help and README; list what is left and fix it.
- [ ] **Step 4: Update** help articles for Prospects and Calendar (table and cards, filters, views, see by person) and the README demo guide; delete the dead CSS.
- [ ] **Step 5: Run the whole verification**: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm --filter @auditos/web exec next build`, then `pnpm --filter @auditos/e2e e2e`. Expected: all pass.
- [ ] **Step 4: Manual sweep at 1280px and 768px** as Grace (partner), Daniel (manager), Brian (staff) and Wanjiru (administrator) on Today, Pipeline, Calendar (all four views), Clients, an engagement, Billing and People; confirm the Review Focus items by eye and fix anything clipped.
- [ ] **Step 5: Commit** `docs: describe the redesigned screens; remove unused styles`.

---

## Self-review notes

- Spec coverage: Inter (T1); shared components and rules (T2, applied T4-T15); Pipeline (T3-T4); Calendar month, panel, grids and see-by-person (T5-T7); grouped menu, Billing and Quality merges, Today (T8-T9); every remaining screen (T10-T15); tests, help and README (in each task and T16). The spec's redirect requirement is met by keeping routes and adding tab bars (no URL moves), recorded in Global Constraints.
- Types: `ProspectFilter`/`Stage` (T3) are used in T4; `calendar.ts` names (T5) are used in T6-T7; `NavGroup`/`navFor`/tab helpers (T8) are used by `Nav`, `BillingTabs`, `QualityTabs`; `TodayRow`/`buildToday` (T9) are used only by the Today page.
- One deliberate deviation from the spec text: the spec said old URLs "redirect to the right tab"; this plan keeps the old routes as the real pages instead, which keeps every bookmark working without redirect logic.
