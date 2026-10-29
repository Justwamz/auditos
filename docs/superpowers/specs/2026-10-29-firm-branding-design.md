# Firm branding: logo, letterhead and brand colours

Date: 2026-10-29. Status: draft for approval. Builds on the simple UI redesign (branch feat/simple-ui-redesign).

## Why

AuditOS is sold to audit firms that each have their own identity. A firm with a red brand should not have to send clients
documents, or look at an app, that is visibly someone else's green product. The partner's moment: sending the first quote or
invoice and the client seeing the firm's own letterhead; and the firm's people opening the app and seeing the firm's colours.

## What the owner decided

- The firm administrator (and only the firm administrator) can set branding. Partners, managers and staff cannot.
- Letterhead details: location (address), website, phone number, email, and "the normal details in an invoice", with the firm's
  brand applied. The words "Powered by AuditOS" must **always** show and no setting can remove them.
- Two colours, primary and secondary, set by the administrator. If a picked colour is hard to read, the system **adjusts it
  automatically** to the nearest readable shade and says so on the page.
- The firm's logo replaces the AuditOS name at the top of the menu, with a small "Powered by AuditOS" line beneath it.
- Branding applies to quotes, invoices, their emails, **and the exported financial statements** (PDF, Word, Excel where a
  header is meaningful).

## Goals

1. A "Branding" page under the Firm menu group, visible and editable only by the firm administrator.
2. Per-firm logo, contact details, footer note, primary and secondary colour, stored with the firm.
3. The app theme (menu rail, main buttons, links, active tab, tinted backgrounds) follows the firm's two colours.
4. Letterhead on the invoice and quote pages, PDFs, emails, and exported statements.
5. A live preview before saving, and "Reset to AuditOS colours".

## Non-goals and anti-goals

- No per-user themes, no dark mode, no custom fonts, no custom domains or white-labelling that removes "Powered by AuditOS".
- Status colours stay fixed for every firm: green (done), amber (soon), red (overdue or blocked), and the calendar kind colours.
  A red-branded firm must never see "our brand" and "overdue" look the same.
- The sign-in page stays AuditOS-branded (the firm is unknown before sign-in). The firm's name and logo appear after sign-in.
- Branding never changes what anyone is allowed to see or do. It is presentation only.
- A badly chosen brand must never make text unreadable (contrast stays at WCAG AA or better) or break the 13px text floor.

## Where it fits in the existing system (facts from the code)

- `billing_settings` (migration 0025) already holds per firm: `legal_name`, `address`, `kra_pin`, `bank_details`, prefixes and
  payment terms. It is edited today on Billing > Settings by partners and administrators (`canManageBilling`). The invoice PDF
  prints `issuer.legalName` (`packages/exports/src/billing-pdf.ts`).
- The colours live as CSS custom properties on `:root` in `apps/web/app/globals.css` (`--ledger`, `--ledger-deep`,
  `--ledger-wash`, `--paper`, `--sheet`, `--rule`, shadows tinted green, and the rail's own shades). Status and calendar kind
  colours are separate tokens.
- The API already accepts uploads (`@fastify/multipart`, used by Evidence). Row-level security scopes data per firm.
- Exports live in `packages/exports` (`pdf.ts`, `docx.ts`, `xlsx.ts`, `billing-pdf.ts`).

## Design

### Data
A new table `firm_branding` (one row per firm, RLS like `billing_settings`): `tenant_id`, `primary_color` and `secondary_color`
(`#rrggbb`), `logo` (bytes, small, validated) with `logo_type`, `logo_updated_at`, `phone`, `email`, `website`, `footer_note`.
Existing `legal_name`, `address`, `kra_pin` and `bank_details` stay in `billing_settings` and are shown on the Branding page too
(one form, two tables behind it) so there is a single place to edit the letterhead. Builder's call whether those four fields
are edited through a shared endpoint or the Branding endpoint writes both; they must not diverge or be duplicated.

Colours and the logo are not secrets, but they are firm-owned: reads by any signed-in member of that firm (the theme needs
them on every page); writes only by the firm administrator, enforced in the API and in RLS, with an entry in the activity
history ("changed the firm's branding").

### Logo
PNG, JPG or SVG, up to about 1 MB. The API validates the real type (not the file name), strips scripts from SVG or rejects SVG
that cannot be made safe (an uploaded SVG must never run script), caps pixel size, and serves it from an authenticated route
with a short cache. Builder chooses the safest approach (rasterising SVG to PNG on upload is acceptable). Without a logo the
documents and menu show the firm's name in the primary colour.

### Colours and theme
The administrator picks two colours. The system derives the full set (deep, wash, tint, rail shades, shadow tint) from them and
guarantees contrast: white text on the primary, ink text on washes, link and focus colours at AA. If a pick fails, the page
shows the adjusted colour, what changed, and why ("We made your red a little darker so white text stays easy to read").
The derived tokens are served with the firm's profile and applied once at the app shell as CSS custom properties, so every
screen picks them up with no per-page change. The pre-paint theme must not flash green first (set before first paint).
Primary: menu rail, main buttons, links, active tab, focus accents. Secondary: lighter accents (selected chips, highlighted rows,
tinted backgrounds, small badges). The default (no branding saved) is exactly today's green, pixel for pixel.

### Letterhead on documents
One shared letterhead block (logo or name, address, phone, email, website, KRA PIN) used by: the invoice and quote pages, their
PDFs, the saved emails, and exported statements. Bank details and footer note appear on invoices and quotes only. Every document
ends with a small "Powered by AuditOS" line. Colours on PDFs use the primary colour for the header rule and totals and must print
legibly in black and white. Exported statements get the logo, firm name and contact line in the header and the footer line; the
statements' own layout and numbers do not change.

### The Branding page (firm administrator only)
Plain words, one main button ("Save branding"), one sentence under the title. Sections: Logo (upload, replace, remove), Contact
details (firm name, address, phone, email, website, KRA PIN, bank details, footer note), Colours (primary, secondary, each with a
picker and a hex box; adjustment note), Preview (a menu strip, a button, a table row, and an invoice header, updating live) and
"Reset to AuditOS colours". Menu entry sits in the Firm group for the administrator only; the ten-link menu cap still holds
(builder to confirm and, if needed, merge into an existing Firm item as a tab rather than add an eleventh link).
Billing > Settings keeps rates, taxes and invoice numbering; its invoice-details section points to Branding for the letterhead.

## Constraints

- Plain words everywhere (the plain-words guard applies; no "hex", "token" or "CSS" in user text: say "colour code").
- Inter stays the typeface. Same shared primitives (PageHead, SidePanel, Disclosure, Chips).
- Security: only the administrator writes; validate every field (email, website scheme http or https only, phone length); the logo
  route is authenticated and tenant-scoped; no stored markup is ever rendered unescaped (footer note is plain text).
- Tests: contrast derivation as pure unit tests (including pure red, pure yellow, white, black, near-white); API tests for who may
  write and RLS isolation between firms; e2e for the administrator flow, a non-administrator being unable to see or call it,
  the theme applying across several pages, and the letterhead appearing on an invoice and in the PDF text.

## Left to the builder

Storage of the logo (database bytes versus files), the exact derivation maths, the picker control, PDF layout details, and the
precise wording of copy in the plain-words table.

## Open for the owner's call (defaults chosen)

- Default when only one colour is set: derive the secondary from the primary (my call).
- Whether partners should be able to view the Branding page read-only (default: no, administrator only, as asked).

## Calls made after the builder check (mine, to be checked by the owner)

- **"Administrator"** means the existing firm administrator: the `firm_admin` role or the administrator permission (`is_tenant_admin`), the same people who run People today. Not partners.
- **Statement exports:** branding is passed in through `ExportMeta`; the API loads the logo bytes. PDF and Word get logo, firm name, contact line in the header and "Powered by AuditOS" in the footer. Excel gets one header row of text (firm name and contact line) above the existing content and the footer line in the last row; no image in Excel. Statement figures and layout otherwise unchanged.
- **Emails** are saved as plain text today, so emailed letterhead is text only: firm name, address, phone, email, website, then "Powered by AuditOS". No emailed logo.
- **Letterhead fields:** legal name, address, phone, email, website, KRA PIN (and bank details and footer note on invoices and quotes). Invoice number, dates and payment terms are document content and unchanged. A blank field is left out silently; with no name at all, "Audit firm" as today.
- **Colour rules:** the primary must give at least 4.5:1 against white (it carries white text). If it fails, darken it step by step until it passes and say so. Secondary: ink text must reach 4.5:1 on its derived wash, and it must stay distinguishable from the primary; adjust if not. PDFs use the primary for rules and totals and are checked to stay legible in black and white. Very pale picks (white, light yellow) get darkened to the nearest readable shade of the same hue; the page shows before and after.
- **No green flash:** the derived tokens are returned with the signed-in profile and also cached in a cookie that the server layout reads, so the first paint is already branded; a save refreshes the cookie. A signed-out visitor sees the AuditOS default.
- **Default:** keeping today's token values as the defaults, with one unit test that the default theme equals them; the audit of hard-coded green outside `globals.css` (rail shades, shadows, PDFs) is part of the work.
- **Logo limits:** PNG or JPG only for now, up to 1 MB and 2000 px on the long side; transparency fine; no animation. SVG is rejected (no new native dependency, no script risk); revisit later. On the dark rail the logo sits on a small white rounded plate, so any logo is visible. 
- **Menu cap:** Branding becomes a tab on the existing "Quality and independence"-style Firm area only if the Firm group would exceed ten links; the builder checks the count and reports.
- **Activity history:** one entry per save naming who, when and which parts changed (logo, colours, details); colour values are included, the logo is just "changed".
- **Help:** one short help article for Branding, covered by the plain-words check. Logo route is authenticated and carries a version in the address (`logo_updated_at`) so changes show immediately.
- **Validation:** phone up to 30 characters of digits, spaces, plus, dashes and brackets; website must start with http or https; email must look like an email.

## Owner's decisions on the two open questions

1. **Letterhead fields that exist today** (legal name, address, KRA PIN, bank details): partners keep editing them on
   Billing > Settings, exactly as now. The administrator-only Branding page writes only the new items: logo, colours, phone,
   email, website and footer note. The Branding page shows the four existing fields read-only with a pointer to Billing >
   Settings, so the letterhead preview is complete.
2. **Issued documents are frozen.** When an invoice or quote is issued, the letterhead as it was at that moment (name, address,
   phone, email, website, KRA PIN, bank details, footer note, primary colour, and the logo image or a reference to that exact
   logo version) is stored with the document. Its page, PDF and emails always show that stored letterhead, never the firm's
   current branding. Drafts show the current branding and take their snapshot when issued. Consequence for the builder: logo
   versions must be kept while any issued document refers to them (store logos immutably by version), and an issued invoice
   must keep rendering after the firm changes or removes its logo. "Powered by AuditOS" is always printed from the current
   version of the document layout, not the snapshot.
