# Mobile layout, installable app (PWA) and firm-logo favicon

Date: 2026-10-29. Status: approved in chat by the owner (after branding; mobile and PWA together; logo as favicon).

## Why

The site is not usable on a phone: below 52rem the menu becomes a wrapped block of about ten links above every page, and tables, side panels and forms were never checked at phone width. Accountants and auditors want to open it from a phone, add it to the home screen, and see their own firm's logo in the browser tab.

## Owner's decisions

- After branding, mobile responsive and PWA are done together.
- The firm logo is the favicon (tab icon), for signed-in users.
- Defaults I proposed and the owner did not change: AuditOS icons for the installed app until a firm has a logo; offline shows only a plain "You're offline" page, never cached audit data; a small "Install AuditOS" button only where the browser offers it; one help article.

## Goals

1. Every page is comfortable at 375px and 390px wide, and still right at 768px and 1280px: no horizontal page scroll, text at least 16px in inputs (no iOS zoom), tap targets at least 44px.
2. A "Menu" button opens the navigation on small screens (a drawer), closes on choosing a link, on Escape and on tapping outside; focus is managed; the ten-link menu cap still holds.
3. Tables scroll sideways inside their own container (or reflow to stacked rows where a table is the main content, such as Prospects and Clients) instead of overflowing the page.
4. Side panels fill the screen on phones. Forms, tab bars, chips, the calendar, the invoice and quote pages, the Branding page and its preview all fit.
5. Installable: web app manifest (name AuditOS, short name AuditOS, standalone, start_url /, icons 192, 512 and a maskable 512), theme colour, a service worker that caches only the static app shell assets and an offline page, never API responses or pages with data.
6. Firm logo as favicon and home-screen icon: signed-in pages use a square icon made from the firm's current logo (logo centred on a white square with padding, any size), falling back to the AuditOS icon when the firm has no logo or its logo cannot be read. The sign-in page and signed-out visitors always get the AuditOS icon.
7. A small "Install AuditOS" button (plain words) only when the browser offers installing; never on the sign-in page; dismissible.
8. One short help article on adding the app to a phone's home screen; the Branding page and branding help say the logo also becomes the tab and home screen icon.

## Non-goals and anti-goals

- No offline data, no offline editing, no sync, no push notifications. Audit data must stay current and off the device.
- The service worker must never cache or serve authenticated responses (pages, /me, API, logo images). A user who signs out must not see another person's data from a cache.
- No change to what anyone may see or do. No change to desktop look beyond small fixes the work requires.
- "Powered by AuditOS" stays always present; AuditOS stays on the sign-in page.
- Plain words everywhere (the plain-words guard applies).

## Constraints and facts

- Next.js 15 App Router; theme CSS lives in apps/web/app/globals.css (597 lines; today only a 52rem rule for the shell and a few calendar and component media queries). Viewport meta is already set in app/layout.tsx.
- There is no public/ folder and no icons yet. Create AuditOS icon files (simple mark on the brand green) as static PNGs and an SVG source.
- Branding: logo stored as immutable versions (firm_logos, PNG or JPEG up to 1 MB, 2000px), served by an authenticated, tenant-scoped route `/branding/logo/:id` on the API; /me returns branding (logoId) or null.
- Square icon: needs resizing and padding on the server. Pick the lightest approach: first try drawing with pdfkit-free pure code only if trivial; otherwise add one well-known pure-JS or prebuilt-binary image dependency (for example sharp, which has prebuilt binaries for Linux/Render) and tell the owner in the report. Decode only after pngDecodes passes; any failure falls back to the AuditOS icon. Cache by logo id (immutable).
- Per-firm manifest: a route that returns a manifest for the signed-in firm (name = firm name, icons = the firm's square icon route) and a plain AuditOS manifest when signed out. The browser must fetch it with credentials (crossorigin use-credentials). Icons and manifest for the installed app must work for the firm's session only.
- Render serves HTTPS, which service workers require. The service worker file must be served from the site root with a no-cache header.
- Accessibility: the drawer is a dialog-like region with a visible focus ring, Escape closes, focus returns to the Menu button; reduced-motion respected.
- Tests: Playwright projects or viewport tests at 375x812 and 768x1024 (the existing e2e uses isolated ports 3100/4110; keep them); an assertion helper that the page has no horizontal overflow; tests that the drawer opens, closes and navigates; manifest and service worker tests; unit tests for the icon route (valid logo, damaged logo, no logo, other firm's logo id returns nothing); the plain-words sweep must pass with the new text.

## Left to the builder

CSS techniques (container queries versus media queries), the exact drawer markup, icon artwork, the image library choice for the square icon (reported), caching strategy details inside the rule above.
