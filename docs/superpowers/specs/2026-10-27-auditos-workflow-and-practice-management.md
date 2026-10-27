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
