# Stage 5: time, fees, quotes, invoices and the billable dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** The firm records time and expenses, sets rates and flat fees, sends quotes and invoices with the taxes it chooses per invoice, tracks payment, and sees billable summaries by role. Invoices go through a tax-submission provider that is a clearly labelled simulation until KRA credentials exist.

**Architecture:** A pure money engine in `packages/fs-engine` (`tax.ts`: line amounts, exclusive and inclusive taxes, compounding, exact rounding). Migrations: 0025 billing settings, rates, tax catalogue and engagement fees; 0026 time entries and expenses; 0027 quotes, invoices, payments, numbering and the simulated outbox; 0028 simulated tax submission results. The API adds `/billing/*`, `/time`, `/expenses`, `/quotes`, `/invoices`, `/billing/summary`. Totals are computed by the engine on the server and stored; once an invoice is issued its lines, taxes and totals can no longer change (database trigger). Providers (`TaxProvider`, `EmailProvider`) are interfaces with a simulation and an unconfigured real slot each.

**Spec:** `docs/superpowers/specs/2026-10-27-auditos-workflow-and-practice-management.md`

## Global Constraints
- KES only; amounts are integer cents in the database and decimal strings in JSON; never floating point.
- Tax is optional and chosen on each invoice: any number up to five, each with a rate and "on top of the previous tax"; the invoice is either tax-exclusive or tax-inclusive. No tax is preselected.
- Hourly rates are visible only to managers, partners and people holding the administrator permission. Staff see their own hours, not rates or values.
- An issued invoice is immutable. Corrections are by voiding with a reason and issuing a new one.
- Invoice numbers are sequential per firm and year and have no gaps.
- Nothing is represented as submitted to KRA while the provider is the simulation: the invoice, its PDF and the screen all say so.

## Review Focus
- Inclusive and exclusive totals always add up to the cent, for every combination of taxes tested.
- A staff member cannot read another person's time, any rate, or any invoice.
- A time entry or expense that has been invoiced cannot be changed or deleted.
- Issuing the same invoice twice does not consume two numbers or bill the time twice.

### Task 1: Money engine (tax.ts)
Interfaces: `lineAmount(quantity: string, unitCents: bigint): bigint`; `computeTotals(lines: { quantity: string; unitCents: bigint }[], taxes: TaxSpec[], mode: 'exclusive' | 'inclusive'): Totals`; `TaxSpec = { name: string; rateBp: number; onPrevious: boolean }`.
- [ ] Tests first (red), implement, green, commit.

### Task 2: Settings, rates, tax catalogue, engagement fees
- [ ] Migration 0025; routes `GET/PUT /billing/settings`, `GET/PUT /billing/rates`, `GET/POST/PATCH /billing/taxes`, `GET/PUT /engagements/:id/fee`; tests for who may read and write.

### Task 3: Time and expenses
- [ ] Migration 0026; `/time` and `/expenses` routes; rate snapshot at entry; invoiced entries immutable; visibility by role; tests.

### Task 4: Quotes, invoices, payments, simulated providers
- [ ] Migration 0027/0028; `/quotes`, `/invoices` (draft from unbilled time and expenses, issue, pay, void, PDF), `/outbox`; tests including numbering, immutability, tax totals through the API, provider labelling.

### Task 5: Billable dashboard
- [ ] `GET /billing/summary` scoped by role; tests.

### Task 6: Screens, help, demo data, browser tests
- [ ] Timesheet, Billing (rates, taxes, settings), Quotes, Invoices, dashboard cards; help articles; demo data; browser specs.

### Task 7: Verify and ship
- [ ] Full tests, typecheck, lint, production build, browser suite; push.
