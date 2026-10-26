# AuditOS: Audit Practice Platform: Draft Spec v0.1

Status: **DRAFT for discussion. Not locked.** Items marked **[CALL]** are my assumptions; items in section 16 need your decision.

## 1. Intent

A multi-tenant audit management and financial-statement-drafting platform for a small Kenyan audit firm serving SME clients in trading, rental, farming, consultancy, pensions and investments. It must:

1. Drive each engagement through a standards-based workflow (ISA, ISQM 1, ICPAK requirements) with checklists, working papers, review and sign-off.
2. Make the firm able to pass ICPAK Audit Quality Review (AQR) by producing evidence of ISQM 1 operation on demand.
3. Draft financial statements from a trial balance under IFRS for SMEs or full IFRS.
4. Enforce strict controls on deleting and editing documents, especially after manager/partner review.
5. Be hardened from the first commit, because it holds confidential client financial data.

### Goals
- One engagement = one auditable, tamper-evident file with a clear state and sign-off trail.
- Checklists generated from the engagement's risk and entity profile, not a static list of 400 questions.
- Firm-level ISQM 1 quality management system (QMS), not just engagement-level.
- Draft FS exportable to Word/PDF/Excel, with every figure traceable to the TB and every disclosure to a checklist.
- Multi-tenant from day one (firm = tenant), even though one firm is the first user.

### Non-goals (v1)
- Tax computation or KRA iTax filing.
- Bookkeeping or accounting for clients. This is not a ledger.
- Replacing audit data-analytics tools (IDEA/ACL). Basic sampling only.
- Client-facing portal with write access to the engagement file (a limited PBC portal is in phase 2).
- Consolidation of complex groups (single-entity plus simple group in phase 3).
- Native mobile apps. Responsive web only.

### Anti-goals (failure even if it "works")
- Reproducing copyrighted ISA / IFRS text verbatim. Checklists are firm-authored paraphrases that reference paragraph numbers (see section 12).
- A tick-box tool that lets staff mass-tick "N/A" with no rationale.
- Any path by which one firm, or one unassigned staff member, can see another's client data.
- Silent changes to reviewed work.

## 2. Users and roles

Roles are per tenant, and assignment is per engagement (not just global):

| Role | Can |
|---|---|
| Firm Admin | Manage users, firm settings, templates. **No access to engagement content by default.** |
| Partner (EQR-capable) | Approve, sign off, unlock locked files with reason, sign the report. |
| Manager | Review, sign off, raise review notes, approve deletions of draft items. |
| Senior / Staff | Prepare working papers, answer checklists, upload evidence. |
| Quality / ISQM Officer | Run the firm QMS, monitoring, root cause analysis. Read-only on engagements for monitoring. |
| Engagement Quality Reviewer (EQR) | Read-only plus EQR sign-off on listed engagements. |
| Client contact (phase 2) | Upload PBC items, answer requests, no view of the audit file. |
| Platform Operator (us) | Infrastructure only. No access to tenant data (see section 9). |

Rules enforced in the system, not by convention: preparer cannot review own work; reviewer must be higher grade than preparer; the engagement partner cannot be the EQR; independence declaration must be on file before a person can be assigned.

## 3. Core domain model

- **Tenant** (firm) → **Client** (entity) → **Engagement** (a period audit) → **Working papers** (sections, checklists, documents) → **Evidence**.
- **Client profile**: sector (trading, rental, farming, consultancy, pension scheme, investment vehicle), legal form, reporting framework (IFRS for SMEs / full IFRS), year end, regulators (RBA, CMA, SACCO Societies Regulatory Authority if applicable, KRA/Companies Registry), group structure.
- **Engagement states**: Onboarding → Planning → Fieldwork → Completion → Review → Partner approved → Report issued → Archived/Locked. Transitions are gated (see section 6).

## 4. Feature modules

### 4.1 Client acceptance and continuance (ISQM 1 / ISA 220 / ISA 210)
- Client risk assessment, integrity checks, conflicts check across the firm's client list, AML/KYC record (POCAMLA considerations).
- Independence and ethics declarations per person per engagement (IESBA Code, ICPAK Code), annual and per-engagement, with threats-and-safeguards log.
- Engagement letter generation from templates; signed copy upload; version history.

### 4.2 Planning and risk
- Understanding the entity, materiality calculator (benchmark, percentage, performance materiality, clearly trivial threshold), with rationale required and partner approval.
- Risk register: inherent/control risk assessment, significant risks, fraud risk (ISA 240), going concern (ISA 570), related parties (ISA 550), laws and regulations (ISA 250) linked to procedures.
- Audit strategy and plan memo templates.

### 4.3 Standards-based checklist engine
- Library of checklist templates mapped to ISA clauses, ISQM 1 components and ICPAK AQR focus areas. **[CALL: firm-authored content, versioned; see section 12.]**
- Checklists are **generated by rules** from the client profile and risk assessment (e.g. farming adds biological assets, rental adds investment property and lease testing, pension scheme adds RBA compliance and member benefit testing, investments add valuation and custody).
- Each item has: response (Yes / No / N/A), mandatory rationale for N/A and No, link to working paper or evidence, preparer, reviewer, review status.
- Completeness dashboard per engagement; engagement cannot advance to Review with open mandatory items.
- Template versioning: engagements pin to the template version they started on; update notices rather than silent changes.

### 4.4 Working papers and evidence
- Structured sections (lead schedules, testing, confirmations, analytical review, subsequent events, management representations, going concern, summary of unadjusted misstatements, etc.).
- File uploads with SHA-256 hash, malware scan, type allow-list, size limits; cross-referencing between papers and FS lines.
- Sampling helper (random, MUS, systematic) with recorded seed so the sample is reproducible.
- Review notes (points raised by manager/partner) with clear/not-cleared workflow and in-line comments.
- Adjustments journal (proposed, agreed, unadjusted) feeding the TB and FS.

### 4.5 ISQM 1 firm-level quality management (the AQR angle)
- Risk assessment of the firm's quality objectives across the eight ISQM 1 components: governance and leadership, relevant ethical requirements, acceptance/continuance, engagement performance, resources, information and communication, the risk assessment process, monitoring and remediation.
- Quality risks → responses → owners → evidence, reviewed annually.
- Monitoring: cyclical file inspections (sample engagements per partner), findings, root-cause analysis, remedial actions with deadlines, annual evaluation of the QMS and the sign-off by the person ultimately responsible.
- Resources: staff competence, CPD tracking, training records, secondment and outsourcing records.
- EQR: criteria for engagements requiring EQR, assignment, EQR checklist and sign-off.
- **AQR pack**: one-click export of QMS documentation, inspection results, independence records, CPD, and a selected engagement's file with its sign-off trail, for ICPAK reviewers.

### 4.6 Financial statements drafting
- Trial balance import (Excel/CSV templates, and later QuickBooks/Xero/Sage connectors). Validation: balances, duplicates, period.
- Chart-of-accounts mapping to a standard FS line taxonomy. Mappings are saved per client and reused year-on-year.
- Prior-year comparatives carried over from the previous engagement.
- Framework option per client: **IFRS for SMEs (including the 2025 third-edition amendments, effective 1 Jan 2027, flagged by period)** or **full IFRS**. **[CALL: confirm which edition is needed for 2026/2027 year ends; section 16.]**
- Statements generated: statement of financial position, comprehensive income, changes in equity, cash flows (indirect method, derived with exception flags), accounting policies and notes.
- Disclosure checklist per framework, tied to notes, so a missing disclosure shows up before partner review.
- Sector note packs: investment property and rental income, biological assets and agricultural produce (IAS 41 / SME s.34), financial instruments, leases, revenue, employee benefits, related parties, going concern, events after the period, contingencies. Pension schemes and investment vehicles use their own statement formats.
- Computed notes (ageing, PPE movement schedule, deferred tax schedule input) are editable only through supporting schedules, not free text over numbers.
- Output: DOCX, PDF, XLSX; firm branding; DRAFT watermark until partner approval.
- Explicit scope limit: **the system drafts; it does not decide accounting policy.** Judgements are recorded by humans.

### 4.7 Reporting and completion
- Audit report templates (unmodified, qualified, adverse, disclaimer, going-concern material uncertainty, emphasis of matter, KAM for listed/PIE) selectable and reviewed by the partner.
- Management letter generator from the findings register.
- Completion checklist, representation letter, final analytical review, file assembly date, and the **60-day assembly deadline tracker** after the report date (ISA 230 / ISQM 1; see section 16).

### 4.8 Practice management (lightweight)
- Engagement budget vs actual hours (timesheets), deadlines, calendar and reminders.
- Client list, contacts, regulatory filing deadlines.
- Dashboards by role: partner (all engagements at risk), manager (my reviews), staff (my tasks).

## 5. Document and review control (the key requirement)

This is the heart of the integrity model, enforced at the database and API layers, not only in the UI.

### 5.1 Item lifecycle
`Draft → Prepared → Manager-reviewed → Partner-approved → Locked`
Each sign-off records user, role, timestamp, and the **content hash** of the item at that moment.

### 5.2 Edit rules
| State | Who can edit | Effect |
|---|---|---|
| Draft / Prepared | Preparer; others if assigned | New version saved on each change. |
| Manager-reviewed | Preparer or manager | **Edit auto-revokes the review** and returns the item to Prepared. Reviewer is notified. Diff shown to reviewer. |
| Partner-approved | Partner only, with a mandatory reason | Revokes partner and manager sign-offs, creates a new version, notifies all. |
| Locked (after report issued / archived) | **No one** by normal means | Only the Partner can **unlock**; it needs a reason, a second approver (another partner or the quality officer), and creates a visible unlock event. Post-lock additions go in as dated, attributed addenda, never as overwrites. |

### 5.3 Delete rules
- **No hard deletes of working paper content from the application**, ever. Deleting = soft delete (tombstone) with reason, who, when.
- Draft items: preparer can delete; manager can delete any draft.
- Reviewed or approved items: deletion needs a **two-person approval** (requester plus manager/partner of equal or higher grade) with a recorded reason, and the item stays recoverable and visible in the audit trail.
- Locked engagements: delete disabled.
- Hard purge happens only through a **retention process**: after the retention period expires (default 7 years, configurable above a floor; **[CALL]**), by a partner and the firm admin together, with no legal hold, producing a purge certificate. Legal hold blocks purge.
- Uploaded files go to object storage with versioning and object-lock (WORM) in compliance mode on locked engagements.

### 5.4 Audit trail
- Append-only event log for every read of sensitive items, every write, every sign-off, unlock, delete request, export, permission change and login event.
- **Hash-chained** (each event includes the hash of the previous one) with periodic anchoring of the chain head into separate storage, so tampering is detectable.
- Written by the database through triggers, so that application bugs cannot skip it; the application role has no UPDATE/DELETE on the log table.
- Viewable per item ("history" tab) and exportable for AQR.

## 6. Engagement gates

| Transition | Gate |
|---|---|
| Onboarding → Planning | Acceptance approved by partner, independence declarations in, engagement letter on file. |
| Planning → Fieldwork | Materiality and risk assessment approved by manager and partner. |
| Fieldwork → Completion | All mandatory checklist items answered, TB mapped, review notes cleared or accepted. |
| Completion → Partner approved | Disclosure checklist complete, going concern concluded, EQR sign-off where required. |
| Partner approved → Report issued | Report signed by the partner, FS finalised (watermark removed). |
| Report issued → Archived/Locked | File assembly within the deadline; auto-lock at the deadline. |

## 7. Architecture **[CALLS throughout]**

- **Monorepo**: pnpm workspaces plus Turborepo, TypeScript end to end.
  - `apps/web`: Next.js (React), server components, strict CSP.
  - `apps/api`: NestJS (Fastify adapter), REST plus OpenAPI; zod/class-validator at every boundary.
  - `apps/worker`: background jobs (BullMQ/Redis or pg-boss): virus scan, export generation, retention, notifications.
  - `packages/db`: schema and migrations (Drizzle or Prisma plus raw SQL for RLS and triggers), typed query layer.
  - `packages/standards`: checklist templates, FS taxonomy, disclosure checklists as versioned data (JSON/YAML in-repo, loaded to DB per release, reviewed by a qualified person in PRs).
  - `packages/fs-engine`: pure, deterministic functions: TB to mapped lines to statements to notes. Heavily unit-tested with golden files.
  - `packages/authz`: policy definitions shared by API and web.
  - `packages/ui`, `packages/config`, `packages/audit-log`.
- **Database**: PostgreSQL. Managed (e.g. AWS RDS in `af-south-1`, Cape Town, or an Africa-region equivalent) **[CALL: data residency per Kenya Data Protection Act 2019; section 16]**.
- **Object storage**: S3-compatible with versioning and object lock.
- **Hosting**: containers on managed infrastructure, IaC with Terraform, separate dev/staging/prod accounts.
- **Observability**: structured logs with PII redaction, metrics, traces, alerting.
- **Exports**: server-side DOCX (docx lib) / XLSX / PDF (headless render), generated in the worker, signed URLs with short expiry.

### Suggested repo layout
```
apps/{web,api,worker}
packages/{db,standards,fs-engine,authz,audit-log,ui,config}
infra/{terraform,docker}
docs/{superpowers/specs,adr,runbooks,threat-model}
.github/workflows
```

## 8. Multi-tenancy

- **Tenant = audit firm.** Every tenant-scoped table carries `tenant_id` (NOT NULL, part of composite FKs so cross-tenant references are impossible).
- **PostgreSQL Row-Level Security** on every tenant table, with the tenant bound per transaction from the authenticated session (`SET LOCAL app.tenant_id`). The application connects as a role that does **not** bypass RLS; no superuser or owner role at runtime.
- **Engagement-level access control** on top (ethical walls): a user sees an engagement only if assigned to it, or holds a partner/quality role with explicit scope. Enforced by RLS plus API policy checks.
- **Per-tenant encryption keys** (envelope encryption with KMS): field-level encryption for sensitive fields (bank details, ID numbers), per-tenant key for file objects. **[CALL]**
- Tenant isolation tests in CI: automated tests attempt cross-tenant reads and writes on every table and endpoint; the build fails if any succeed.
- Tenant-aware rate limits, quotas, and data export/offboarding procedure (tenant can retrieve all its data).
- Pooled database for v1 (shared schema, RLS). Design leaves room to move a large tenant to its own database later.

## 9. Security hardening (from commit one)

**Identity and access**
- MFA mandatory (WebAuthn/passkeys and TOTP); no SMS. SSO (OIDC/SAML) optional per tenant. Argon2id password hashing, breached-password checks, lockout and throttling.
- Short-lived access tokens, rotating refresh tokens, server-side session revocation, device list, idle and absolute timeouts, re-auth (step-up) for sign-off, unlock, delete approval and export.
- Authorization: deny by default, centralised policy engine (RBAC plus engagement assignment plus state-based rules), every endpoint declares its policy; tests ensure no route lacks one.
- Platform operators have **no standing access** to tenant data; break-glass access is time-boxed, approved, logged and visible to the tenant.

**Application**
- Input validation and output encoding everywhere; parameterised queries only; strict CSP, HSTS, secure cookies (HttpOnly, SameSite), CSRF protection, CORS allow-list, security headers.
- File handling: type sniffing, allow-list, malware scanning (ClamAV) in quarantine before availability, no inline serving of user HTML/SVG, filename sanitising, download via signed URLs on a separate domain.
- Rate limiting and abuse detection; generic error messages; no stack traces to clients.
- Exports and bulk downloads are watermarked with user/time and logged.

**Data**
- TLS 1.2+ everywhere, encryption at rest (DB, storage, backups), secrets in a secrets manager (never in repo or env files in images).
- Backups encrypted, immutable, tested restores; stated RPO ≤ 15 min, RTO ≤ 4 h **[CALL]**; DR runbook.
- **No real client data or PII in dev, test, fixtures, logs or this repo.** Synthetic seed data only; staging uses synthetic data.
- PII minimisation and redaction in logs and error trackers.

**Supply chain and pipeline**
- Lockfiles, pinned dependencies, automated updates with review, `pnpm audit`/OSV scanning, SBOM generation, signed container images, minimal base images, non-root containers.
- CI: lint, type-check, tests, SAST (CodeQL/Semgrep), secret scanning (gitleaks), IaC scanning (tfsec/checkov), container scanning, DAST against staging.
- Branch protection, mandatory review, signed commits, no direct pushes to main; environments gated.
- Annual external penetration test before go-live and each year after; threat model (STRIDE) maintained in `docs/threat-model`.

**Compliance**
- Kenya Data Protection Act 2019: data controller/processor roles (firm is controller, we are processor), ODPC registration obligations, DPIA, breach notification process (72 h), data subject request handling, data processing agreement template, records of processing.
- ISO 27001-aligned controls as the target framework (certification is not required in v1).

## 10. Non-functional requirements
- Availability 99.5% in business hours initially; zero-downtime migrations.
- Performance: pages under 2 s p95 for typical engagements (about 50 MB, 2,000 items); FS generation under 30 s.
- Accessibility: WCAG 2.1 AA.
- Browser support: current Chrome, Edge, Firefox, Safari.
- Internationalisation: English; currency KES default with multi-currency support in FS (functional/presentation currency, IAS 21 inputs).
- Timestamps UTC, shown in Africa/Nairobi.

## 11. Testing strategy
- Unit tests on `fs-engine` with golden-file statements for each sector and framework.
- Integration tests with a real Postgres for RLS, triggers, state machine and audit-log chain verification.
- Property tests: FS always balances; sign-off invalidation invariants hold under any edit sequence.
- Tenant-isolation and authorization matrix tests (generated from the policy definitions).
- E2E (Playwright) for the engagement happy path and the review/unlock/delete flows.
- Standards content reviewed by a qualified auditor on each change (CODEOWNERS on `packages/standards`).

## 12. Standards content and licensing
- ISAs and ISQMs are IAASB publications (copyright IFAC); IFRS texts are IFRS Foundation copyright; ICPAK materials are ICPAK's. **We do not embed the standards' text.** Checklists are firm-authored questions referencing paragraph numbers.
- Confirm with IFAC/IFRS Foundation/ICPAK whether any content licence is needed for the planned use, before shipping templates.
- ICPAK AQR requirements and checklist formats change; content is data with versions and effective dates, not code. **A named qualified person at the firm owns content accuracy**; the software provides a mechanism, not professional assurance.
- Disclaimer that the output is a draft for professional judgement.

## 13. Phasing **[CALL]**

| Phase | Scope |
|---|---|
| 0 | Repo, CI/CD, IaC, auth (MFA), tenancy with RLS, audit log, threat model, tenant-isolation tests. No features until this passes. |
| 1 | Clients, engagements, roles and assignments, document control (edit/delete/lock rules), checklist engine with ISA starter set, review notes, sign-offs. |
| 2 | TB import and mapping, FS engine for IFRS for SMEs (trading, consultancy, rental), exports, disclosure checklists. |
| 3 | ISQM 1 firm QMS module, monitoring and AQR pack, EQR, independence and CPD. |
| 4 | Full IFRS, farming, pensions, investments packs; PBC client portal; accounting-package connectors; sampling tools; practice management and timesheets. |

Rationale: the integrity and security backbone is the hard-to-retrofit part, so it goes first. Sector packs come last because they are the most content-heavy.

## 14. Risks
- **Content volume and accuracy**: checklists and disclosures are a large content project. Mitigation: start with a core set per sector, and have an owner with sign-off.
- **FS scope creep**: IFRS is big. Mitigation: framework and sector coverage matrix with explicit "not supported" disclosures.
- **Standards change** (ISA 220 and ISQM updates, IFRS for SMEs third edition): versioned content with effective dates.
- **Over-trust**: users may treat generated FS as correct. Mitigation: watermark, exception flags, human judgement records.
- **Single-firm start masks multi-tenant bugs**: isolation tests with at least two synthetic tenants from phase 0.

## 15. Success measures
- A mock ICPAK AQR can be satisfied from system exports alone.
- Zero cross-tenant leakage in isolation tests and the pen test.
- A reviewed item cannot change without the sign-off being revoked (verified by property tests).
- Draft FS produced from a TB in under 30 minutes of staff time for a typical SME.

## 15b. Decisions recorded (2026-10-26)

1. **SaaS for multiple firms**: yes. Tenant admin, onboarding and isolation are first-class.
2. **Data residency in Kenya**: required. Conflict: Render (planned host) has no African region. Production hosting is **unresolved**: obtain legal advice on Data Protection Act 2019 and its 2021 Regulations, or choose a Kenyan/African host. Keep deployment portable (containers, 12-factor config, no Render-specific services). Local dev unaffected.
3. **Sectors first**: trading, consultancy, rental (my call), then farming, pensions, investments.
4. **Regulated clients**: SMEs first, regulated (RBA/CMA) later.
5. **IFRS for SMEs edition**: support both, selected by period. 2nd edition (as amended) for periods before 1 Jan 2027; 3rd edition (2025) for periods beginning on or after 1 Jan 2027. Full IFRS as a second framework.
6. **Content**: user will supply firm checklists/templates later. Until then, I author placeholder starter content, clearly labelled as unreviewed.
7. **Delivery**: build now, run locally on localhost; Render hosting later.

## 16. Open questions for you (superseded where answered above)

1. **Firm model**: sole firm now with others later (SaaS), or only this firm indefinitely? It changes billing, onboarding and how much tenant-admin UI we build.
2. **Data residency and hosting**: must data stay in Kenya, or is South Africa/EU acceptable? Cloud or the firm's own servers?
3. **Retention and assembly deadlines**: confirm the firm's retention period (I assumed 7 years) and the file-assembly deadline (assumed 60 days, per ISA 230/ISQM 1 practice). Verify against ICPAK guidance.
4. **IFRS for SMEs edition** needed for the first engagements (2nd edition vs 2025 third edition).
5. **Sector priority**: which two sectors go first? I assumed trading, consultancy and rental.
6. **Regulated clients**: do pension schemes (RBA) and investment vehicles (CMA) need regulator-specific report formats in v1, or later?
7. **Listed/PIE clients**: any, or none? It affects KAMs and EQR scope.
8. **Who owns standards content** at the firm (the qualified person who signs off checklist templates)?
9. **Team size and users**: roughly how many staff and concurrent engagements? Sizes the infrastructure and the permissions complexity.
10. **Client portal**: needed in v1, or are PBC lists by email acceptable at first?
11. **Integrations**: which accounting packages do clients use (QuickBooks, Sage, Zoho, Excel only)?
12. **Existing assets**: do you have current checklists/templates (Word/Excel) to digitise? They would shorten the content work.
13. **Branding and naming**: is "AuditOS" the product name?
14. **E-signature**: should sign-off use only in-app signing, or also a qualified digital signature on the audit report (Kenya Information and Communications Act recognises electronic signatures)?
