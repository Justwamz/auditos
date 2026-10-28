export interface NavItem { href: string; label: string }
export interface NavGroup { heading: string | null; items: NavItem[] }
export interface TabDef { href: string; label: string; show: boolean }

function flags(role: string, isAdmin: boolean) {
  const admin = role === 'firm_admin';
  const holdsAdmin = admin || isAdmin;
  return {
    admin,
    holdsAdmin,
    seesTrail: holdsAdmin || role === 'manager' || role === 'partner',
    works: ['partner', 'manager', 'senior', 'staff'].includes(role),
    billing: role === 'partner' || role === 'manager' || holdsAdmin,
  };
}

/** The side menu for a role: groups in a fixed order, empty groups left out. */
export function navFor(role: string, isAdmin: boolean): NavGroup[] {
  const f = flags(role, isAdmin);
  const groups: { heading: string | null; items: (NavItem & { show: boolean })[] }[] = [
    { heading: null, items: [{ href: '/', label: 'Today', show: !f.admin }] },
    {
      heading: 'My work',
      items: [
        { href: '/calendar', label: 'Calendar', show: !f.admin },
        { href: '/timesheet', label: 'Timesheet', show: !f.admin },
      ],
    },
    {
      heading: 'Clients and audits',
      items: [
        { href: '/clients', label: 'Clients', show: true },
        { href: '/engagements', label: 'Engagements', show: !f.admin },
      ],
    },
    {
      heading: 'Business',
      items: [
        { href: '/pipeline', label: 'Prospects', show: f.works },
        { href: '/billing', label: 'Billing', show: f.billing },
      ],
    },
    {
      heading: 'Firm',
      items: [
        { href: f.admin ? '/audit-trail' : '/independence', label: 'Quality and independence', show: true },
        { href: '/admin/users', label: 'People', show: f.holdsAdmin },
      ],
    },
    { heading: null, items: [{ href: '/help', label: 'Help', show: true }] },
  ];
  return groups
    .map((g) => ({ heading: g.heading, items: g.items.filter((i) => i.show).map(({ href, label }) => ({ href, label })) }))
    .filter((g) => g.items.length > 0);
}

/** Tabs shared by every billing page. Empty for people who cannot see billing. */
export function billingTabs(role: string, isAdmin: boolean): TabDef[] {
  const f = flags(role, isAdmin);
  if (!f.billing) return [];
  return [
    { href: '/billing', label: 'Overview', show: true },
    { href: '/invoices', label: 'Invoices', show: true },
    { href: '/quotes', label: 'Quotations', show: true },
    { href: '/billing/outbox', label: 'Sent emails', show: true },
    { href: '/billing/settings', label: 'Settings', show: f.admin || role === 'partner' || isAdmin },
  ];
}

/** Tabs shared by the independence and activity history pages. */
export function qualityTabs(role: string, isAdmin: boolean): TabDef[] {
  const f = flags(role, isAdmin);
  return [
    { href: '/independence', label: 'Independence', show: !f.admin },
    { href: '/audit-trail', label: 'Activity history', show: f.seesTrail },
  ];
}

/** A tab bar is worth showing only when there are at least two tabs to choose between. */
export function shownTabs(tabs: TabDef[]): boolean {
  return tabs.filter((t) => t.show).length >= 2;
}

/** The tab whose address best matches the path (longest prefix; `/billing` itself only matches exactly). */
export function currentTab(tabs: TabDef[], path: string): string {
  let best = '';
  for (const t of tabs) {
    const hit = t.href === '/billing' ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
    if (hit && t.href.length > best.length) best = t.href;
  }
  return best;
}

/** Whether a menu link is the current one. Billing also covers invoices and quotes; Quality covers the activity history. */
export function isCurrent(href: string, path: string): boolean {
  if (href === '/') return path === '/';
  const under = (h: string) => path === h || path.startsWith(`${h}/`);
  if (href === '/billing') return under('/billing') || under('/invoices') || under('/quotes');
  if (href === '/independence' || href === '/audit-trail') return under('/independence') || under('/audit-trail');
  return under(href);
}
