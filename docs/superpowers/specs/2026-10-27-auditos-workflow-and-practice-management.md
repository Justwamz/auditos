# AuditOS: guided workflow and practice management (addendum to the 2026-10-26 design)

Status: approved in conversation on 2026-10-27; implementation in stages below. Extends [2026-10-26-auditos-design.md](2026-10-26-auditos-design.md).

## Why
The first build is correct but feels complicated to the people who will use it. The firm's real day runs as: signed LOE, assignment, pre-planning meeting (auditor and manager), pre-audit client meeting, planning (system documentation, risk, materiality, time budget, client knowledge), fieldwork, review, draft financials, management letter. Pain points: producing simplified but adequate ISA/ICPAK checklists, review, drafting financials, opening balances, management letters. Partners also need to see what staff are doing, what is in the pipeline, and billable summaries.

## Decisions (the user's, unless marked "my call")
- Currency KES. Time entered manually. No e-signature (signed LOE is an uploaded PDF, both signatories recorded). Rates are set by the firm per grade; a flat fee per client or job is also allowed.
- **Named people only.** No shared or role mailboxes (admin@, info@, accounts@ ...). Each user is one named person with their own sign-in and authenticator. "Admin" is a permission a person holds alongside a role, not a separate generic account. My call: the invite and tenant-creation paths reject generic mailbox names and require a full name.
- **Access by assignment.** Team members see only clients and engagements they are assigned to (client list, documents, calendar, pipeline, dashboard). Partners and holders of the admin permission see all clients. Managers see the clients they manage and engagements they are on.
- **Account manager.** Every client has exactly one account manager (manager or partner). Partner or admin may reassign with a reason; history is kept. A user who still manages clients or prospects cannot be deactivated until they are handed over; orphans show on the partner dashboard. Prospects work the same way.
- **PII.** Phone, email, ID number, KRA PIN and bank account numbers are masked by default, on the server. Any member of the engagement may reveal with a reason; each reveal is logged with the reason.
- **Audit trail in plain English.** Every action on a client file, including views, reveals and downloads, is recorded as a sentence plus structured fields (actor, verb, object, client, time). Names are snapshotted at write time. Repeat views within a few minutes collapse. The log stays append-only and hash-chained. Partners and admins see all; managers see their engagements; staff do not see the log.
- **Version history.** Every document and the management letter keep every version, who changed what, with a visible difference. Version rows are immutable (database-enforced). Restoring creates a new version.
- **Help section.** Searchable articles tagged by role; the server returns only what the signed-in role may see; results come back as small cited chunks so a chatbot can use the same retrieval later. No chatbot now.
- **Calendar.** Shared calendar of meetings, fieldwork, deadlines and leave; engagement milestones appear automatically; visibility follows assignment.
- **Pipeline.** Prospect, proposal/quote, LOE sent, won or lost; owner, expected fee, expected start. "Won" converts to client and engagement.
- **Fees, quotes, invoices.** Quotes (create, send as PDF, accept, convert to fee). Invoices numbered, KES, statuses draft/sent/part-paid/paid/overdue, payments recorded by hand. Tax is optional and chosen per invoice from a firm tax list; each tax line is inclusive or exclusive and may apply to the base or on top of earlier taxes (excise then VAT); the invoice keeps a snapshot of the rates. No tax is preselected.
- **KRA eTIMS.** Invoices go through a tax-submission provider interface. Only a simulation provider exists (made-up control number, "SIMULATION - not submitted to KRA" on the invoice); the KRA provider is an unconfigured slot. Email gets the same provider pattern with a visible simulated outbox. Invoices are not tax-valid until a real provider is configured.
- **Expenses.** Client receipts (fuel, stationery) are audit evidence tested through a vouching/sampling schedule (sample, receipt attached, supported or exception, exceptions flow to findings). The firm's own job costs are recorded as engagement expenses with a receipt and may be re-billed. Bookkeeping for clients is an optional module, off by default, enabled per client; it comes after the core stages.
- **Bank statements.** Text PDFs are supported from the first version (CSV and Excel also). Every upload passes a preview where detected columns and rows are confirmed or corrected. A completeness check (opening balance plus transactions equals closing balance) blocks silent partial reads. Password-protected PDFs ask for the password at upload; it is used once and never stored. Scanned PDFs are rejected with a clear message. Analysis is fixed rules (monthly flows, large, round and duplicate items, period-end and weekend spikes, cash-heavy activity, reconciliation to the trial balance bank line) that feed the going-concern, journal and related-party checklists. Evidence is stored encrypted in the database on the free Render plan; real use needs object storage.
- **Guided roadmap.** One screen per engagement following the firm's process, with a next-step panel, progress, and a review queue for managers and partners. Existing tabs remain underneath.
- **Checklists.** Plain-language yes/no/not-applicable with ISA references: acceptance and continuance, LOE, client knowledge, system documentation, risk assessment and responses, materiality calculator, time budget, laws and regulations, related parties, IT environment, trial balance and journal entries, going concern, opening balances, subsequent events, representations, review. Existing clients carry forward last year's answers and confirm only changes. Wording is firm-authored draft, labelled unreviewed, until the firm's auditor has reviewed it.
- **Opening balances.** Prior-year audited closing balances are compared with this year's opening trial balance, differences flagged, the opening-balances checklist pre-filled; first-year audits have their own path.
- **Management letter.** Findings are recorded during the audit (issue, risk, recommendation, management response, status); a Word draft is generated from them with follow-up of prior-year points; partner approval before export; versioned.

## Non-goals
Accounting ledger or tax filing; a real KRA connection (until credentials exist); OCR of scanned statements; a chatbot; e-signature; client portal.

## Stages
1. Roadmap and checklists
2. Named users and permissions, assignment-based access, audit trail, PII masking, version history
3. Help section
4. Calendar, pipeline and account managers
5. Fees, quotes, invoices with flexible tax, simulated eTIMS and email providers, engagement expenses, billable dashboard
6. Bank statement analysis and the vouching/sampling schedule
7. Opening-balances check and management letter

Stage 2 precedes the features that store more personal data. Each stage ships with tests and is verified before the next begins.

## Open items
- Two sample bank statements for tuning the PDF parser were promised but have not arrived in the conversation. Redacted copies or synthetic ones only; no real client data. Needed before stage 6, not before.
- VAT default rate and the tax list contents are the firm's to confirm.
- Checklist wording needs the external auditor's review.

## Stage 6 as built
- Bank statements: text PDFs (positioned-text reading), CSV and Excel. Scanned PDFs, non-PDFs and files with no statement table are refused with a reason; a PDF password is asked at upload, used once and never stored or logged. Entries are stored encrypted; only the last four digits of the account are kept. Every statement is checked (opening + entries = closing, each running balance follows, unreadable rows) and must be confirmed by a person before analysis; one that does not add up needs a reason, kept on the record. A confirmed statement cannot be changed or deleted.
- Analysis rules (plain, visible, not AI): possible duplicates, returned items, large weekend entries, large entries near period end, round sums, overdrawn days, cash and mobile-money shares, related-party names, reconciliation to the books. Each is worded as something to look at and points at the checklist it supports.
- Sampling: random, monetary-unit and top-items selection from an uploaded population; the seed, method and a fingerprint of the population are recorded so a draw can be repeated; results (supported, exception with amount and note, not tested with a reason) record who and when; receipts from the engagement's evidence can be linked; the summary gives counts, an exception rate and a simple projection labelled as an indication, never a conclusion.
- Only verified on synthetic layouts. Real bank layouts will differ; the screen asks for redacted samples when a file will not read.

## Platform administration (planned, not built)

AuditOS is multi-tenant: audit firms are tenants. Today a firm is created with one protected API call and a shared platform token. That is acceptable for a demo and not for running a service. The operator of the platform needs its own application, separate from the firm-facing app.

**Principles**
- Platform operators are named people in their own table (`platform_users`), never members of a firm, with mandatory authenticator codes (the fixed demo code is never accepted there) and their own sessions.
- Separate application (`apps/platform`) on its own hostname. It is not part of the firm app bundle and is reachable only by operators (optionally behind an IP allowlist).
- Operators run as a separate database role (`auditos_platform`) that can call only `platform_*` functions. It has no table access to firm data, so row-level security keeps holding: operators see counts and status, never working papers, clients or personal data.
- Everything operators do is written to a platform audit log (own hash chain), in plain English like the firm trail.

**Capabilities, in build order**
1. Firms: create (with a named first admin, as now), suspend and reactivate (a suspended firm cannot sign in; data is kept), rename, and see status.
2. People support: re-send the first admin's invite, reset a locked-out admin's authenticator after a recorded identity check. Operators do not set passwords.
3. Plans and limits: seats, storage, feature switches per firm (for example bank statement analysis, bookkeeping module).
4. Health and usage: sign-ins, active users, storage used, errors; no content.
5. Support access: a firm admin grants time-limited access to a named operator, with a reason; every action under it is visible to the firm in its own audit trail. No standing access.
6. Subscription billing of firms and invoices to firms (a later stage, after practice invoicing).

**Replaces:** `POST /platform/tenants` with `PLATFORM_ADMIN_TOKEN`. The token endpoint stays until the platform app exists, and is removed after.

**Decisions needed before building:** who the first operators are (named people), and whether operators may ever read firm content (the plan says no; a regulator or firm contract might ask for support access, which is why item 5 exists).
