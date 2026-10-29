# Firm Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each firm's administrator set a logo, contact details and two brand colours that restyle the app and appear on quotes, invoices, their saved emails and exported financial statements, always with "Powered by AuditOS".

**Architecture:** A pure `@auditos/brand` package turns two picked colours into a guaranteed-readable palette. A new `firm_branding` table (plus immutable `firm_logos` versions) holds the settings; `/me` returns the derived theme, so the server-rendered app layout applies it before first paint. Issuing an invoice or sending a quote stores a write-once letterhead snapshot with the document; PDFs, pages and emails render from that snapshot. Statement exports get branding through `ExportMeta`.

**Tech Stack:** Next.js 15 / React 19 (plain CSS tokens), Fastify + zod + Postgres RLS (`packages/db/migrations`), pdfkit / docx / exceljs-style exporters in `packages/exports`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-firm-branding-design.md` (binding; its "Calls made after the builder check" and "Owner's decisions" sections are part of it).

## Global Constraints

- Administrator = the existing firm administrator: `firm_admin` role or the administrator permission (`is_tenant_admin`), never partners. Only they write branding; every signed-in member of the firm may read the theme and logo.
- Partners keep editing legal name, address, KRA PIN and bank details on Billing > Settings. The Branding page owns logo, primary and secondary colour, phone, email, website, footer note and shows the four existing fields read-only.
- "Powered by AuditOS" always shows (menu under the logo, footer of every quote, invoice, email text, statement export) and no setting removes it. The sign-in page stays AuditOS-branded.
- Colours: primary gives at least 4.5:1 against white; secondary's derived wash gives at least 4.5:1 against ink `#1d2733`; unreadable picks are darkened step by step (same hue) and the page says what changed. Status colours (`--red-pen`, `--amber*`, green for done) and calendar kind colours never change per firm. With no branding saved, the app is exactly today's palette.
- Logo: PNG or JPG only, at most 1 MB and 2000 px on the long side, type checked from the file's bytes not its name; SVG and animated files rejected. Logos are immutable versions; a version is never deleted while an issued document refers to it. Logo route is authenticated and tenant-scoped, versioned by id.
- Issued documents are frozen: the letterhead (name, address, phone, email, website, KRA PIN, bank details, footer note, adjusted primary colour, logo id) is written once when an invoice is issued or a quote is sent and always used afterwards; drafts use current branding.
- Emails are plain text: firm name, address, phone, email, website, then "Powered by AuditOS"; no logo. Excel statements get one header row of text and a last footer row; no image.
- Validation: phone up to 30 characters of digits, spaces, plus, dash, brackets; website must start with http:// or https://; email must look like an email; footer note plain text up to 300 characters; blank fields are left out silently.
- Plain words in all user text (`apps/web/lib/plain.ts` BANNED_WORDS and the shared list in `e2e/helpers.ts`): say "colour code", never "hex", "token" or "CSS". 13px text floor, Inter, one primary button per screen, shared primitives (`PageHead`, `SidePanel`, `Disclosure`, `Chips`, `SectionHead`), errors shown once. Ten-link menu cap (`lib/nav.ts`): if the Firm group would exceed it, Branding becomes a tab of an existing Firm page instead of a link.
- Help stays true: every task that changes what a person sees or does updates the matching articles in `packages/help/content` in the same task (billing and invoices guides in Task 6, the statement export guide in Task 7, the new Branding article in Task 5, a menu or People mention if the Firm group changes), and `pnpm --filter @auditos/help test` must pass.
- Strict TypeScript (`noUncheckedIndexedAccess`). Restore `apps/web/tsconfig.tsbuildinfo` if a typecheck changes it. E2E runs use the project's private Postgres on 5433 (never 5432), spec files one at a time.

## Review Focus

- A pale or extreme pick (white, light yellow, pure red, near-black) still yields readable text everywhere, and the page says what changed (Task 1, 5).
- A red-branded firm still sees overdue and "done" as unmistakably different from its brand (status colours unchanged) (Task 4).
- An issued invoice still renders with its original letterhead and logo after the firm changes or removes its logo, address or colours (Task 2, 6).
- A partner, manager or staff member cannot read-write branding by UI or direct API call, and one firm can never read another firm's logo or branding (Task 2, 3).
- An uploaded file renamed to .png that is not a real PNG, an oversized image, an SVG, or a script-bearing file is rejected with a plain message (Task 3).

---

### Task 1: Palette derivation package

**Files:**
- Create: `packages/brand/package.json`, `tsconfig.json`, `src/index.ts`, `src/palette.ts`, `test/palette.test.ts` (copy the layout and scripts of `packages/authz`; add to the workspace)

**Interfaces:**
- Produces: `contrastRatio(a: string, b: string): number` (hex `#rrggbb`), `isHex(s: string): boolean`, `DEFAULT_BRAND: { primary: '#2e6b4c'; secondary: '#e3eee4' }`, and
  `derivePalette(input: { primary: string; secondary: string }): { palette: Palette; adjustments: Adjustment[] }` where `Adjustment = { field: 'primary' | 'secondary'; from: string; to: string; reason: string }` (reason is plain English) and `Palette` is a record of the CSS variable names listed below to `#rrggbb`/`rgba()` strings, plus `primary` and `secondary` (the adjusted picks).
  Palette variable names (exactly): `--ledger` (primary), `--ledger-deep`, `--ledger-wash`, `--rule`, `--rule-strong`, `--paper`, `--sheet`, `--rail-bg`, `--rail-fg`, `--rail-muted`, `--rail-active`, `--rail-line`, `--shadow-tint` (rgb triple such as `30, 74, 52`), `--accent` (secondary), `--accent-wash`. Defaults must equal today's `globals.css` values exactly when given `DEFAULT_BRAND`'s primary and a default secondary (builder reads `globals.css` and `Nav` CSS for the current rail shades and records them in the test).

- [ ] **Step 1: Write failing tests** in `test/palette.test.ts`: `contrastRatio('#000000','#ffffff')` is 21; `derivePalette({primary:'#2e6b4c', secondary:'#e3eee4'}).palette` deep-equals the current `globals.css` values with `adjustments` empty; for each of `#ffffff`, `#ffff00`, `#fde047`, `#ff0000`, `#000000`, `#f8f8f8` as primary, `contrastRatio(palette['--ledger'], '#ffffff') >= 4.5`, the hue is within 8 degrees of the input except for pure grey, and `adjustments` has a `primary` entry exactly when the input was changed; `#ffffff` secondary yields an adjustment when it is indistinguishable from the primary or from paper; invalid hex throws `Error('colour code must look like #1a2b3c')`.
- [ ] **Step 2: Run** `pnpm --filter @auditos/brand test`. Expected: FAIL (package missing).
- [ ] **Step 3: Implement** `derivePalette` in HSL/relative-luminance maths: darken primary in 2% lightness steps until 4.5:1 on white; deep = primary darkened 15%; wash = primary at about 12% on white; rail background = deep; rail text and muted derived to keep at least 4.5:1 on the rail background; secondary adjusted until ink on its wash reaches 4.5:1 and it differs from primary by at least a lightness or hue margin; reasons read like "We made your red a little darker so white text stays easy to read."
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(brand): palette derivation with guaranteed contrast`.

### Task 2: Database: branding, logo versions, frozen letterhead

**Files:**
- Create: `packages/db/migrations/0031_firm_branding.sql`; tests in `apps/api/test/` following the existing RLS tests' style (find them with `grep -rl "rls\|isolation" apps/api/test packages/db`)

**Interfaces:**
- Produces tables: `firm_logos(id uuid pk, tenant_id, content_type text check in ('image/png','image/jpeg'), bytes bytea check octet_length <= 1048576, width int, height int, created_at)` insert-only (no update or delete grant); `firm_branding(tenant_id pk, primary_color text, secondary_color text, logo_id uuid null references firm_logos, phone, email, website, footer_note, updated_at)` with the validation rules from Global Constraints as check constraints; columns `letterhead jsonb` (null until issued) on `invoices` and `quotes`.
- Produces functions (security definer, `search_path` pinned, like `invoice_issue`): `can_edit_branding() returns boolean` (`is_tenant_admin()` or role `firm_admin`; read how `is_tenant_admin` and the `firm_admin` role are defined in `0001_tenancy.sql` and later migrations), `branding_save(p_branding jsonb, p_changed text[]) returns void` (admin only; upserts and appends one audit entry `branding.updated` with `{changed}`), `branding_add_logo(p_type text, p_bytes bytea, p_w int, p_h int) returns uuid` (admin only), `invoice_set_letterhead(p_id uuid, p_letterhead jsonb)` and `quote_set_letterhead(p_id uuid, p_letterhead jsonb)` (write-once: only when `letterhead is null` and status is not draft; invoice requires `can_manage_billing()`, quote requires creator or `can_manage_billing()`), and a trigger or guard ensuring `invoices_guard`/`quotes_guard` do not allow `letterhead` to be changed once set.
- RLS: `firm_branding`, `firm_logos` readable by any member of the tenant, writable only through the functions.

- [ ] **Step 1: Write failing tests**: a firm administrator can save branding and add a logo; a partner, manager and staff each get a forbidden error from both functions; firm B cannot select firm A's `firm_branding` or `firm_logos` rows; a second `invoice_set_letterhead` on the same invoice fails; a draft invoice cannot get a letterhead; `firm_logos` rows cannot be updated or deleted by the app role; check constraints reject a bad email, a `ftp://` website, an oversize logo, `image/svg+xml`.
- [ ] **Step 2: Run** the new API tests. Expected: FAIL.
- [ ] **Step 3: Write the migration** (next number after 0030; confirm the highest) following the grants, `revoke ... from public` and `grant execute ... to auditos_app` pattern of `0028_invoicing.sql`; `branding_save` calls `audit_append_internal` like `invoice_issue` does.
- [ ] **Step 4: Run** the API tests, `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): firm branding, immutable logo versions, frozen letterhead`.

### Task 3: API: branding routes and theme on /me

**Files:**
- Create: `apps/api/src/branding/routes.ts`, `apps/api/src/branding/logo.ts`, `apps/api/test/branding.test.ts`
- Modify: `apps/api/src/app.ts` (register routes), `apps/api/src/auth/routes.ts` (`/me`), `apps/api/src/audit/sentences.ts` (sentence for `branding.updated`), `apps/api/package.json` (add `@auditos/brand`)

**Interfaces:**
- Consumes: `derivePalette`, `DEFAULT_BRAND` (Task 1); SQL functions (Task 2); `actorOf`, `httpError`, `tenantCtx` from `../authz`; `@fastify/multipart` as used in `apps/api/src/evidence/routes.ts`.
- Produces routes (all `config: { access: 'tenant' }`): `GET /branding` (any member) returns `{ branding: { primary, secondary, phone, email, website, footerNote, logoId: string | null, adjustments: Adjustment[], firm: { legalName, address, kraPin, bankDetails } }, canEdit: boolean }`; `PUT /branding` (admin) body `{ primary, secondary, phone?, email?, website?, footerNote? }` (strict zod, blank string clears a field) returns the same shape and applies `derivePalette`, saving the adjusted colours; `POST /branding/logo` (admin, multipart) returns `{ logoId }` and sets it current; `DELETE /branding/logo` (admin) clears the current logo reference only; `GET /branding/logo/:id` (any member of the owning firm) streams the bytes with `Cache-Control: private, max-age=31536000, immutable`.
- `/me` gains `branding: { palette: Record<string,string>, name: string, logoId: string | null } | null` (the derived palette for the active firm; null when the firm has none saved; `name` is `billing_settings.legal_name` falling back to the firm name).
- Exports helper `loadLetterhead(tx): Promise<Letterhead>` in `apps/api/src/branding/letterhead.ts` where `Letterhead = { name: string; address: string|null; phone: string|null; email: string|null; website: string|null; kraPin: string|null; bankDetails: string|null; footerNote: string|null; primary: string; logoId: string | null }` (used in Tasks 6 and 7).

- [ ] **Step 1: Write failing tests** (`apps/api/test/branding.test.ts`): admin PUT then GET round-trips and `/me` carries the palette; a pale primary is saved darkened and `adjustments` says so; partner, manager and staff PUT/POST/DELETE get 403; another firm's logo id returns 404; uploads rejected with a plain message for: a text file named `x.png`, a 3 MB image, an SVG, a 3000 px image, a GIF; a valid small PNG and JPG accepted; invalid phone, email and website rejected; the activity history shows the plain sentence after a save.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** routes and `/me` change. Read image type and size from the bytes (PNG/JPEG signatures and header dimensions, no new native dependency); error messages are user-facing strings ("That file is not a PNG or JPG picture.", "Logos can be at most 1 MB.", "Logos can be at most 2000 pixels wide or tall.").
- [ ] **Step 4: Run** the API tests, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): branding routes, logo upload, theme on /me`.

### Task 4: Web theme and menu

**Files:**
- Modify: `apps/web/app/(app)/layout.tsx`, `apps/web/components/Nav.tsx`, `apps/web/app/globals.css`, `apps/web/middleware.ts` only if the CSP requires it
- Create: `apps/web/lib/theme.ts`, `apps/web/test/theme.test.ts`

**Interfaces:**
- Consumes: `/me` `branding` (Task 3); logo route `/api/branding/logo/:id`.
- Produces: `themeStyle(palette: Record<string,string> | null): string` returning a CSS declaration string (`--ledger: #…; …`) or `''` for null; `Nav` props gain `logoId: string | null; brandName: string`.

- [ ] **Step 1: Write failing tests**: `themeStyle(null)` is `''`; `themeStyle(derivePalette(defaults).palette)` contains exactly the default values (guards "pixel for pixel"); a red palette sets `--ledger` and `--rail-bg` but contains no `--red-pen`, `--amber`, `--amber-wash`, `--red-wash` or `--kind-` keys. Add an e2e (in `design.spec.ts`) with the firm administrator saving a red brand through the API, then asserting `getComputedStyle(document.documentElement or .shell).getPropertyValue('--ledger')` is the saved red on `/`, `/clients`, `/calendar` and that `--red-pen` is unchanged and the menu shows "Powered by AuditOS".
- [ ] **Step 2: Run** the unit test. Expected: FAIL.
- [ ] **Step 3: Implement**: the layout already fetches `/me` on the server, so apply the palette there before first paint (a nonce'd `<style>` or style attribute, whichever the existing CSP allows: read `apps/web/middleware.ts` first); replace hard-coded greens and rail shades in `globals.css` and `Nav.tsx` (for example `#235640`, `#a9c4b1`, `#7fa38c`, `#cfe0d4`, `#e9f1ea`, `rgba(46, 107, 76, …)`, green-tinted `--shadow-*`) with the palette variables, with fallbacks equal to today's values so default pages are unchanged; the menu shows the firm logo on a small white rounded plate (or the firm name in white text when no logo), the firm name, and a small "Powered by AuditOS" line beneath; the sign-in page keeps the AuditOS name.
- [ ] **Step 4: Run** the unit tests, the new e2e, then every existing e2e spec file one at a time (default pages must not change), typecheck, lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): app theme and menu follow the firm's branding`.

### Task 5: Branding page (administrator only)

**Files:**
- Create: `apps/web/app/(app)/branding/page.tsx`, `apps/web/components/BrandPreview.tsx`, `packages/help/content/branding.ts` (register the article and category as the other articles are), `e2e/tests/branding.spec.ts`
- Modify: `apps/web/lib/nav.ts` and its test (menu entry or tab, see Global Constraints), `apps/web/lib/plain.ts` only if needed, `e2e/helpers.ts` if a new sign-in is needed

**Interfaces:**
- Consumes: Task 3 routes; shared primitives; `derivePalette` from `@auditos/brand` (a pure package, imported into the web app so the live preview is computed in the browser; the saved, adjusted values still come from the server).
- Produces: route `/branding`; nav item "Branding" in the Firm group for `firm_admin` or `isAdmin` only; the page redirects others to `/`.

- [ ] **Step 1: Write failing e2e** (`branding.spec.ts`): the administrator (Wanjiru) sees "Branding" in the menu, saves two colours, phone, email, website, footer note, uploads a small PNG, and after reload sees them; a pale yellow pick shows the plain note about what changed; "Reset to AuditOS colours" restores the default; a partner, manager and staff do not see the menu entry, and opening `/branding` directly sends them to `/`, and their direct API calls return 403; rejected uploads show the plain messages (text renamed `.png`, SVG, oversize); one main button "Save branding"; the page text passes the banned-word check. Also extend `lib/nav.test.ts` for the administrator-only entry and the ten-link cap.
- [ ] **Step 2: Run** `branding.spec.ts` and the nav tests. Expected: FAIL.
- [ ] **Step 3: Implement** the page: title "Branding" with one sentence, sections Logo, Contact details (the four existing fields read-only with a link "Change these in Billing settings"), Colours (colour picker plus colour-code box for each, adjustment note), Preview (menu strip, button, table row, invoice header; updates live), "Reset to AuditOS colours" as a quiet button, one main "Save branding"; errors shown once; add a short help article "Set your firm's logo and colours" that passes `packages/help` content tests.
- [ ] **Step 4: Run** the e2e, nav and help tests, typecheck, lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): branding page for the firm administrator`.

### Task 6: Letterhead on quotes, invoices, PDFs and saved emails

**Files:**
- Modify: `apps/api/src/billing/invoices.ts`, `apps/api/src/billing/quotes.ts`, `packages/exports/src/billing-pdf.ts`, `packages/exports/test/` (the billing-pdf test), `apps/web/app/(app)/invoices/[id]/page.tsx`, `quotes/[id]/page.tsx`, `apps/web/components/billing.tsx` (a shared `Letterhead` component), `e2e/tests/billing.spec.ts`, `apps/api/test/` billing tests

**Interfaces:**
- Consumes: `loadLetterhead`, `Letterhead` (Task 3); `invoice_set_letterhead`, `quote_set_letterhead` (Task 2).
- Produces: invoice and quote JSON gain `letterhead: Letterhead | null` (for drafts the current `loadLetterhead`, for issued documents the stored snapshot); `BillingPdf.issuer` becomes `letterhead: Letterhead & { logo: { bytes: Buffer; type: 'image/png' | 'image/jpeg' } | null }`; the saved email text builder output starts with the letterhead lines and ends with "Powered by AuditOS".

- [ ] **Step 1: Write failing tests**: API: issuing an invoice stores a snapshot; after the firm changes name, address, colour and removes the logo, GET invoice and its PDF still carry the old letterhead; a draft shows the new one; quote send behaves the same; billing-pdf unit test: PDF text contains the firm name, address, phone, email, website, KRA PIN, "Powered by AuditOS" and omits a blank phone line; a logo image is embedded (PDF contains an image object) and a missing logo falls back to the name; e2e: the administrator brands the firm, Grace issues an invoice, the invoice page shows the letterhead and "Powered by AuditOS", the PDF download text contains them, then the administrator changes the name and the issued invoice still shows the old one.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**: call the set-letterhead function in the same transaction as issue and send; the PDF draws logo (max about 160x60 pt) or name in the primary colour, contact lines, a primary-coloured rule and totals, a footer note and "Powered by AuditOS" on every page; keep the existing watermark and PRACTICE ONLY marks; the black-and-white rule means no information is carried by colour alone; saved emails become letterhead text, body, "Powered by AuditOS"; the web pages render the shared `Letterhead` component with the logo through the authenticated logo route.
- [ ] **Step 4: Run** API, exports and billing e2e tests, then the other e2e specs one at a time, typecheck, lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat: firm letterhead on quotes, invoices, PDFs and emails, frozen when issued`.

### Task 7: Branding on exported financial statements

**Files:**
- Modify: `packages/exports/src/model.ts` (`ExportMeta`), `pdf.ts`, `docx.ts`, `xlsx.ts`, `packages/exports/test/`, `apps/api/src/financials/routes.ts` (around the export handler), `e2e/tests/audit-work.spec.ts` or a new small spec

**Interfaces:**
- Consumes: `loadLetterhead` (Task 3).
- Produces: `ExportMeta.letterhead?: Letterhead & { logo: { bytes: Buffer; type: 'image/png' | 'image/jpeg' } | null }` (optional so existing callers and tests still pass); `footerText(m)` adds "Powered by AuditOS" when a letterhead is present.

- [ ] **Step 1: Write failing tests**: with a letterhead, the PDF text contains the firm name, contact line and "Powered by AuditOS" and embeds the logo; the Word file's header and footer contain them; the Excel file's first row holds the firm name and contact line and the last row the footer line, with every existing cell content and number unchanged (compare against the output without letterhead, shifted by the added rows); without a letterhead, output is byte-for-byte the same as today for PDF text content.
- [ ] **Step 2: Run** `pnpm --filter @auditos/exports test`. Expected: FAIL.
- [ ] **Step 3: Implement** in each exporter; the API loads the letterhead and logo bytes for the engagement's firm and passes them in `meta`.
- [ ] **Step 4: Run** exports and API tests, the export e2e, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(exports): firm branding on exported financial statements`.

### Task 8: Final pass, docs and verification

**Files:**
- Modify: `README.md` (demo guide: Branding page, who can use it, "Powered by AuditOS"), `e2e/tests/plain-words.spec.ts` (add the Branding page for the administrator), `packages/help` if a renamed term needs it

- [ ] **Step 1: Extend the plain-words sweep** to visit Branding as the administrator (with sections open) and assert the banned-word list is clean, run it, fix hits.
- [ ] **Step 2: Manual sweep** with Playwright screenshots at 1280px and 768px of the Branding page, the menu, Today and an invoice for the default green firm and a red firm, as the administrator and as a partner; confirm status colours are unchanged, nothing clips, and contrast looks right; fix issues.
- [ ] **Step 3: Check for leftovers**: grep `apps/web`, `packages/exports` and `apps/api` for hard-coded greens (`#2e6b4c`, `#1e4a34`, `#e3eee4`, `46, 107, 76`, the rail shades) outside the palette defaults and fix or list them.
- [ ] **Step 4: Run the whole verification**: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm --filter @auditos/web exec next build`, then every e2e spec file one at a time. Expected: all pass.
- [ ] **Step 5: Commit** `docs: describe firm branding`.

---

## Self-review notes

- Spec coverage: administrator-only editing and read-only shared fields (T2, T3, T5); logo rules and immutability (T2, T3); contrast adjustment and plain note (T1, T3, T5); theme without flash and fixed status colours (T4); menu logo and Powered by line (T4); letterhead on documents, PDFs, emails with frozen snapshot (T2, T6); statement exports (T7); Branding help article and plain words (T5, T8); activity history entry (T2, T3).
- One deliberate deviation from the spec text: no theme cookie; the app layout already fetches `/me` on the server for every request, so the first paint is branded without one.
- Types: `Letterhead` (T3) is used by T6 and T7; `Palette`/`derivePalette` (T1) are used by T3, T4 and T5; `Adjustment` (T1) is returned by T3 and shown by T5.
