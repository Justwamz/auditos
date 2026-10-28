# Simple UI redesign: pipeline, calendar and a calmer frame for the whole platform

Date: 2026-10-28. Status: draft for approval.

## Intent and why

AuditOS's users are accountants and auditors, many of them wary of software. A system that looks complex gets resisted, and a firm that resists it does not adopt it. Three things make the web app look more complex than it is today:

- The side menu is 13 flat items, shown all at once.
- The Pipeline page stacks a summary, an "Add a prospect" form and a three-column board on one screen. Every card carries a dropdown and two or three buttons. With 30 leads it becomes a wall.
- The Calendar page lists every event of every person in seven narrow columns, each with several lines of text. A busy day, such as six people with events on the same day, is unreadable.

The goal is a calm, familiar interface: fewer things on screen at once, the same patterns everywhere, and borrowing from Outlook where users already know how it works. The existing paper-and-green look (the `--paper`, `--ledger` tokens in `apps/web/app/globals.css`) stays. This is a change of structure and density, not a rebrand.

## Goals

1. **Pipeline** that scales to 30+ prospects and reads at a glance (decided below).
2. **Calendar** that works like Outlook and stays readable on a busy day (decided below).
3. **A shared frame and rules** for the whole app: grouped menu, a "Today" home page, and six rules every screen follows, so people learn one pattern once.
4. Plain accountant language throughout; no software words.

## Non-goals

- No change to permissions, roles, what each role can see, or any API behaviour that enforces them. This is presentation only, except where a new read is needed for the Today page (see "Left to the builder").
- No new colour scheme or logo. The one typographic change is the font: **Inter** becomes the typeface for the whole app (body and headings), replacing the current Segoe UI and Palatino/Georgia stack in `--sans` and `--serif`. Load it with `next/font` so it is self-hosted at build time (no runtime call to a font CDN), with the system sans as fallback.
- No mobile app. The layouts must still work at laptop width (1280px) and degrade sensibly on a tablet, but phone layout is out of scope.
- No drag-and-drop between stages or on the calendar. The existing "move to" and edit actions stay as menu items.

## Anti-goals (a failure even if it technically works)

- Hiding actions people need so well that they cannot find them. Every action that exists today (move stage, mark lost, hand over, make a client, edit and cancel event) must remain reachable in at most two clicks.
- A second visual language on the pages not yet redone. During the transition a half-redesigned app must still look consistent (shared components, same tokens).
- Anything that makes a screen busier than it is today.

## What was decided with the product owner

### Frame (side menu and home)

- Keep the left side menu. Replace 13 flat items with grouped headings, ordered the way an audit firm's day and year actually run (my call, replacing the earlier grouping, per the product owner's request that the menu be logical and simple):
  - **Today** (new home page, replaces Dashboard), always first and on its own
  - **My work**: Calendar, Timesheet (what I am doing and when)
  - **Clients and audits**: Clients, Engagements (the audit work itself)
  - **Business**: Prospects, Billing (winning new clients and getting paid)
  - **Firm**: Quality and independence, People (how the firm is run)
  - Help at the bottom.
- Every label is a plain noun an accountant would use. Maximum of five headings and eight links for any one role; groups a role cannot use are not shown.
- **"Pipeline" is renamed "Prospects"** everywhere people read it (menu, page title, help, chips). The address `/pipeline` and the help topic id stay as they are.
- **Billing, Invoices and Quotations merge into one Billing page with tabs.** Existing role visibility is unchanged: the same people who see Billing, Invoices or Quotations today see the corresponding tab. "Quality and independence" groups the existing Independence and Audit trail pages (as tabs, with Audit trail still limited to its current roles). "People" is the existing "People and access", still admin-only.
- **Today** opens with a greeting and a short list of things that need the person: for example papers waiting for their review, overdue invoices, year ends coming up. Each row is one sentence with an "Open" link. It replaces the Dashboard for everyone except the firm administrator, who currently has no Dashboard (the administrator starts at Clients, see "My calls").

### Rules every screen follows

1. One main action per screen: a green button, top right ("+ Add a prospect", "+ New event"). Everything else is quiet.
2. Forms open in a side panel from that button. They never sit above the list.
3. Lists are tables with search and one-click filters. Clicking a row opens its details.
4. Row actions live in one "..." menu, named in plain words ("Hand over", "Make a client").
5. Every page opens with one sentence saying what it is for, and an empty state written in plain English.
6. Accountants' words, larger readable text, more white space.

### Plain words, across the whole site

Nothing a person reads may sound like software. Audit and accounting terms are fine and stay (engagement, working paper, sign-off, materiality, population, debit, credit, independence, EQR). Software words go. The rule applies to page text, buttons, labels, error messages, empty states, help articles and the sign-in steps. The product owner's request: "the terms used should be non-tech in the entire site".

Replacements (my calls, change any you dislike):

| Today | Plain words |
|---|---|
| Authenticator app / authenticator code | "the code app on your phone" / "6-digit code from your phone" |
| Setup key / Setup link for apps that accept one | "Setup code" / "Can't scan? Use this link" |
| Outbox | "Sent emails" |
| "Not delivered (simulated)" | "Not actually sent (practice mode)" |
| SIMULATION banner and "simulation" tag | "PRACTICE ONLY" and "practice" |
| Audit trail (page, menu, tab) | "Activity history" ("who did what, and when") |
| "recorded in the audit trail" | "recorded in the activity history" |
| Reveal and record | "Show details (this is recorded)" |
| Switch off / Switch on (a person) | "Pause access" / "Restore access" |
| Fingerprint ... recorded; failed the malware scan; quarantined | "Saved and checked"; "failed the virus check"; "failed the virus check and cannot be downloaded" |
| "Your session has ended" / "session needs refreshing" | "You have been signed out. Sign in again." / "Please reload the page." |
| "Something went wrong (code)" | "Something went wrong. Please try again. If it keeps happening, tell your administrator (reference: code)." |
| Risk flags "gate" wording | "hold the engagement back until they are done" |
| Pipeline | "Prospects" |

A single list of banned words (authenticator, outbox, simulat*, session, csrf, malware, quarantine, fingerprint, sha256, tenant, token, payload, api, mfa, totp) is checked by an automated test over the error messages and over every page, so new text cannot slip back in.

### Prospects page (was Pipeline)

- Opens on a **Table / Cards switch**. Table is the default (it scales). The person's last choice is remembered on that browser.
- The five stage numbers at the top become **one-click filters** (All open, Lead, Proposal sent, Engagement letter sent, with Won and Lost counts). The "By person" line for managers and partners becomes a person filter.
- Search by prospect name or owner.
- **"+ Add a prospect"** opens the form in a side panel.
- Table columns: Prospect, Stage, Fee, Expected start, Owner, and a "..." menu. Clicking a row expands it in place (accordion) to show sector, contact, notes and the action buttons: Move to, Hand over, Won: make a client. The Lost-with-reason, Hand-over and Convert forms keep their current fields and validation.
- Cards view keeps today's cards, but each stage is a collapsible section with its count and total, so 30 leads fold to one line.
- Closed (Won and Lost) prospects stay in a separate collapsed section as now.
- Role rules unchanged: managers and partners see everything and the Hand over and Make a client actions; others see only what they own.

### Calendar page

- Outlook conventions: a **Today** button, previous and next arrows, a **Day / Work week / Week / Month** switch, a small month navigator on the left, and colours by kind of event (meeting, fieldwork, deadline, leave, training, other) with a colour legend that doubles as a show/hide filter.
- **Opening view: Month.** Busy days do not list events. A cell shows "N events" and one small coloured dot per person involved. Clicking a day opens a **day panel** on the right.
- **The day panel groups events by person, as an accordion.** The signed-in person starts open and everyone else folded; each event row also expands to show details with Edit and Cancel (still only for events the person created, as today). Auto-generated milestones (year ends, report dates, file-lock deadlines) appear as diamonds and stay read-only.
- **"See by person"** (also reachable from the Day view for partners and managers only): one column per team member on a shared hourly grid, like Outlook's Scheduling Assistant, so clashes and free time are visible. Only people whose events the user can already see appear.
- **Work week** is the Outlook-style hourly grid with events as coloured blocks. Weekend days are hidden in Work week and shown in Week and Month.
- "+ New event" opens the form in a side panel; its fields (title, kind, date, from, to, where, client, engagement, all day, invite) do not change. Same calendar API, same time zone (Africa/Nairobi).
- The existing "Show" person selector for partners and managers remains as a filter.

## Constraints

- Stack as it is: Next.js app in `apps/web`, plain CSS in `globals.css`, no new UI framework. Add shared components (side panel, "..." menu, filter chips, table/cards switch, accordion) in `apps/web/components` and reuse them, so later screens adopt the same patterns.
- Accessibility: keyboard operable (menu, accordion, side panel with focus return and Escape to close), visible focus, colour never the only signal (events also carry text or an icon for their kind), contrast kept at or above the current levels.
- Existing Playwright browser specs in `e2e/tests` and help articles in `packages/help/content` refer to current screen text and routes; they must be updated with the change so the suite passes, and the help for Pipeline, Calendar and Billing must describe the new screens.
- Route changes for merged pages must keep old URLs working (redirect to the new tab), so bookmarks and links in help articles and emails do not break.

## Delivery order (my call)

1. Shared components and rules, then **Pipeline**.
2. **Calendar**.
3. **Frame**: grouped menu, Today page, Billing and Quality tabs.
4. **Remaining screens** (Clients, Engagements, Timesheet, Independence and the rest) brought in line with the six rules, one screen at a time.

Each step ships on its own and leaves the app consistent. **All four steps are in scope** (the product owner asked for the entire site, with the same design language and Inter throughout). In step 4 every remaining screen (login and firm selection, Clients and client page, Engagements and the engagement tabs, Timesheet, Billing sub-pages, Independence, Audit trail, People and access, Help) is brought in line with the six rules and the shared components, without changing what it does or who can see it. Where a screen needs a layout choice not covered here, follow the nearest decided pattern (table with filters and a "..." menu for lists, side panel for forms, accordion for expandable detail) and note the call in the plan.

## Settled after a builder review

### Answered by the existing code (no API change needed)

- **Calendar data.** `GET /calendar` already returns, for the range, every event the database lets the user see (access is enforced in the database, not the page), with `createdBy`, `createdByName`, `attendees` and `mine`. Grouping by person and "See by person" are built client-side from that. "A person involved in an event" means its creator or any attendee, the same rule the existing person filter uses. The people shown as columns are those people, taken from the returned events, with the "Show" selector narrowing them. Same endpoint, same time zone.
- **Today data.** `GET /dashboard` already returns `awaitingReview` (managers, partners and the EQR only), `myDrafts` and `openNotes`. Overdue invoices come from the existing billing summary (`overdue` count and total), and year ends and report dates from the calendar's milestones for the next 14 days. No new endpoint is planned. If one is needed, it must reuse the same access checks.
- **Pipeline counts.** `GET /prospects` computes the stage and owner totals on the server from the same rows the user may see, so filters and counts always agree with the list. Won and Lost counts come from that summary; the Closed section is the same Won and Lost rows.

### My calls (marked so they can be changed)

- **Today rows by role:** awaiting my review (manager, partner, EQR), my drafts and open review notes (anyone who does audit work), overdue invoices (partner, manager, and the administrator who already sees billing), upcoming year ends and report dates (everyone who sees the calendar). A row only appears if the person can act on it.
- **Firm administrator:** has no Dashboard today and gets no Today page. Their menu starts with Clients, and "/" sends them there.
- **Merged pages and old URLs:** `/invoices`, `/quotes`, `/audit-trail` and the other billing and quality pages keep their current routes. A shared tab bar at the top of each page makes them read as one Billing page and one Quality and independence page, so old links and bookmarks keep working with no redirects (this replaces the earlier idea of redirecting). Tabs a role cannot see are not shown, and the server and API checks stay per resource exactly as now.
- **Multi-day and all-day events:** show once on every day they cover (as the page does today). In Month they count towards "N events"; in Week and Work week all-day and multi-day events sit in a strip above the hourly grid. Overlapping events on the hourly grid sit side by side in equal widths.
- **Day by person** is for partners and managers only. Others get Day, Work week, Week and Month for themselves.
- **Tests:** each shipped step adds browser specs for what is new (side panel, accordion, filters, redirects, keyboard use with Escape and focus return) and updates the existing specs. Checked at 1280px wide, and at tablet width for no clipped or unreachable controls.
- **Firm administrator and the calendar:** unchanged, no scheduling.

## Left to the builder

- Exact spacing, type sizes and colours of the new components, within the existing tokens.
- The wording of the empty states and the Today rows.
- Where the "last view" preferences are stored (browser storage is fine).
- How the Today page gets its data. Prefer existing endpoints; add a small read-only endpoint only if something it needs (for example "papers waiting for my review") is not available, keeping all existing access checks.
- Colours for the per-person dots (any distinct, accessible set).
- Tablet behaviour of the side panel and the calendar.
