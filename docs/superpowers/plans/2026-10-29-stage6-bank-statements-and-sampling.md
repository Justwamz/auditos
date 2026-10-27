# Stage 6: bank statement analysis and the vouching / sampling schedule

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Upload a client's bank statement (text PDF, CSV or Excel), check it was read completely, and get a deterministic analysis that feeds the audit checklists. Draw samples from a population (for example a client's fuel or stationery expenses), record what was found against each receipt, and see exceptions and a simple projection.

**Architecture:** A new pure package `packages/bank-statements`: number and date parsing, a table reader that works on positioned text (PDF) or cell grids (CSV, Excel), an integrity check (opening + movements = closing, and each running balance), and the analysis rules. `pdfjs-dist` reads PDF text; scanned PDFs are refused. A second pure module does sampling (seeded random, monetary-unit, top items). The API stores each committed statement and sampling schedule encrypted at rest and scoped to the engagement team; reads are logged. The web adds a Bank statements tab and a Sampling tab on the engagement.

**Spec:** `docs/superpowers/specs/2026-10-27-auditos-workflow-and-practice-management.md`

## Global Constraints
- Rules, not AI: every flag can be explained to an auditor and is reproducible.
- Money is integer cents; parsing never uses floating point.
- Nothing is silently half-read: a statement that does not add up is marked incomplete and cannot be analysed until the person confirms it, with the difference shown.
- A PDF password is used once to open the file and is never stored or logged.
- Scanned (image-only) PDFs are rejected with a clear message.
- Parsing is verified against synthetic statements only. The screen says the readers are tuned on typical layouts, not on every bank's, and asks for redacted samples.
- Statement and population content is encrypted at rest and visible only to the engagement team (partners read).

## Review Focus
- A wrong password, no password, an image-only PDF, a renamed non-PDF and a huge file each give a distinct, clear refusal.
- Columns for debit and credit are never swapped silently; a statement that fails the balance check is flagged, not trusted.
- The same seed gives the same sample; a sample never contains a duplicate item.
- A staff member not on the engagement cannot read or analyse its statements.

### Task 1: Number and date parsing
Interfaces: `parseAmount(text: string): { cents: bigint; side: 'dr' | 'cr' | null } | null`; `parseDate(text: string, order?: 'dmy' | 'mdy'): string | null` (YYYY-MM-DD).
- [ ] Tests first, implement, commit.

### Task 2: Table reader and PDF extraction
Interfaces: `readStatement(input: { kind: 'pdf'; data: Uint8Array; password?: string } | { kind: 'csv'; text: string } | { kind: 'xlsx'; data: Uint8Array }): Promise<ParsedStatement>`; typed `StatementError` codes.
- [ ] Synthetic fixtures: a bank-style PDF, a layout with one signed amount column, an M-Pesa-style layout, a multi-page statement with repeated headers, an encrypted PDF, an image-only PDF; tests, implement, commit.

### Task 3: Integrity check and analysis
Interfaces: `checkIntegrity(p: ParsedStatement)`; `analyse(p: ParsedStatement, opts)` returning monthly flows, flags with severity and the checklist they feed, and optional reconciliation to a trial balance figure.
- [ ] Tests first, implement, commit.

### Task 4: Statements API
- [ ] Migration 0029; upload to preview; commit; list; analysis; reconcile; encrypted storage; team-only; audit sentences; tests.

### Task 5: Sampling
- [ ] Pure sampling module (random, monetary-unit, top items) with tests; migration 0030; API to create a schedule from an uploaded population, record results, link receipts, summarise exceptions; tests.

### Task 6: Screens, help, demo data, browser tests
- [ ] Bank statements and Sampling tabs; help articles; demo statement and schedule; browser specs.

### Task 7: Verify and ship
- [ ] Full tests, typecheck, lint, production build, browser suite; push.
