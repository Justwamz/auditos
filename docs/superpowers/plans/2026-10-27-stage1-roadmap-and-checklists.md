# Stage 1: guided roadmap and checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** One engagement screen that follows the firm's real process with a "next step", the missing ISA/ICPAK checklists in plain language, a materiality calculator, and last-year carry-forward for returning clients.

**Architecture:** New checklist templates are JSON content in `packages/standards`, so the existing generate/answer/completeness code serves them unchanged. A pure `buildRoadmap` function (API) turns facts (checklist completeness per template, key items, state) into ordered steps plus one `next` step; a route gathers the facts; the web Overview renders it. Carry-forward extends the SQL snapshot function to include checklists and fills `prior` fields on generation. Materiality is a pure function in `fs-engine` plus one route that writes the `materiality` item.

**Tech Stack:** TypeScript, Fastify, Postgres RLS, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-auditos-workflow-and-practice-management.md`

## Global Constraints
- Checklist wording is draft, `status: "unreviewed-placeholder"`, plain language, with ISA references.
- Currency KES; money as bigint cents in the engine.
- App role gets no new table grants. Every route declares `config.access`.
- Existing 172 API tests and 3 e2e flows stay green.

## Review Focus
- A returning client's prior answers are shown as suggestions only; they never count as answered.
- Roadmap never reports a step done while a mandatory item is open.
- Materiality rejects negative, zero or absurd benchmark and percentage inputs.
- Staff who are not on the engagement get 404 from the roadmap.
- First-year audits get the opening-balances items; others get the confirm-only version.

### Task 1: New checklist templates
**Files:** Create `packages/standards/content/checklists/{preplanning-meeting,client-meeting,system-documentation,risk-assessment,laws-regulations,related-parties,it-environment,journals-trial-balance,going-concern,opening-balances}.json`; Modify `packages/standards/src/generate.ts`; Test `packages/standards/test/generate.test.ts`.
**Interfaces:** Produces template ids exactly as the file names; `loadTemplates()` returns them.
- [ ] Test: every template has a unique id, unique item ids across all templates, each item has a non-empty question under 300 characters and at least one standardRef, status is `unreviewed-placeholder`.
- [ ] Test: generating for trading with no flags includes every new id; opening-balances has the extra first-year items only with the `first_year` flag.
- [ ] Run, watch fail; add the JSON and register in `loadTemplates`; run, pass; commit.

### Task 2: Materiality calculator
**Files:** Create `packages/fs-engine/src/materiality.ts` (export from index); `apps/api/src/materiality/routes.ts` (register in app); Tests `packages/fs-engine/test/materiality.test.ts`, `apps/api/test/materiality.e2e.test.ts`.
**Interfaces:** `computeMateriality(input: { benchmark: 'revenue'|'total_assets'|'profit_before_tax'|'total_expenses'|'equity'; amount: string; percent: number; performancePercent?: number; trivialPercent?: number }): { overall: string; performance: string; trivial: string }` (amounts as KES strings, throws `RangeError` on invalid input). Route `PUT /engagements/:id/materiality` body `{ benchmark, amount, percent, rationale, performancePercent?, trivialPercent? }`, writes/edits the `materiality` item (version history applies), returns the computed values.
- [ ] Tests first (red): 1% of KES 120,000,000 revenue gives 1,200,000.00; performance 75% gives 900,000.00; trivial 5% of overall gives 60,000.00; negative amount, zero, percent above 20 and non-numeric strings throw; route rejects staff not on the engagement with 404 and rationale under 10 characters with 400.
- [ ] Implement, green, commit.

### Task 3: Carry-forward of last year's answers
**Files:** Create `packages/db/migrations/0012_prior_checklists.sql` (`create or replace` of `engagement_prior_snapshot` adding kind `checklist`); Modify `apps/api/src/checklists/routes.ts`; Test `apps/api/test/checklists.e2e.test.ts` (new describe).
**Interfaces:** checklist item state gains optional `prior: { response: 'yes'|'no'|'na'; rationale: string } | null`. Route `POST /checklists/:id/items/:itemId/confirm-prior` copies the prior answer into the live answer.
- [ ] Test: engagement for a client with an earlier-period engagement whose checklist had answers; generating the new one sets `prior` on matching item ids, `response` stays null, completeness counts them unanswered; confirm-prior answers it and goes through normal versioning; no prior engagement leaves `prior` null.
- [ ] Implement, green, commit.

### Task 4: Roadmap
**Files:** Create `apps/api/src/engagements/roadmap.ts`; Modify `apps/api/src/engagements/routes.ts`; Tests `apps/api/test/roadmap.test.ts` (pure) and `apps/api/test/roadmap.e2e.test.ts`.
**Interfaces:** `buildRoadmap(facts: RoadmapFacts): { steps: RoadmapStep[]; next: RoadmapStep | null; percent: number }` where `RoadmapStep = { id: string; title: string; detail: string; status: 'done'|'current'|'todo'; tab: 'checklists'|'papers'|'evidence'|'financials'|'overview'; action: string }` and `RoadmapFacts = { state: EngagementState; checklists: Record<string, { total: number; answered: number; mandatoryOpen: number }>; hasEngagementLetter: boolean; hasMateriality: boolean; hasRiskAssessment: boolean; hasMappedTb: boolean; openReviewNotes: number; awaitingSignoff: number }`. Route `GET /engagements/:id/roadmap`.
Steps in order: loe (acceptance checklist complete + engagement letter item), preplanning (preplanning-meeting), client_meeting (client-meeting, system-documentation), planning (planning, risk-assessment checklist, materiality item, risk assessment item), fieldwork (fieldwork-core, laws-regulations, related-parties, it-environment, journals-trial-balance, opening-balances, going-concern, mapped TB), review (no open notes, nothing awaiting sign-off), completion (completion checklist). First step not done is `current`; later ones `todo`.
- [ ] Pure tests: nothing generated gives `loe` current with action "Generate checklists"; mandatory open keeps a step current; all done gives `next` null and percent 100; percent counts done steps.
- [ ] Route test: member gets 200, non-member staff 404.
- [ ] Implement, green, commit.

### Task 5: Web
**Files:** Create `apps/web/components/Roadmap.tsx`; Modify `apps/web/app/(app)/engagements/[id]/tabs/Overview.tsx` and `Checklists.tsx`, `apps/web/lib/text.ts`; add Materiality form to Papers tab area (`tabs/Materiality.tsx`).
- [ ] Roadmap panel at the top of Overview: step list with status marks, a single highlighted "Next step" card whose button switches to the right tab or generates checklists.
- [ ] Checklist questions show "Last year: Yes (note)" with a "Same as last year" button when `prior` is set.
- [ ] Materiality form shows the three computed amounts live and saves.
- [ ] Typecheck, lint, manual check in the browser, e2e flows still green; commit.

### Task 6: Verify and ship
- [ ] Full test suite, typecheck, lint, e2e; push; note Render redeploy.
