import type { Role } from '@auditos/authz';

/** Synthetic demo people. Every account is one named person; nobody shares a login. */
export interface DemoFirm {
  name: string;
  slug: string;
  /** Names used by earlier seeds, so existing databases are updated in place. */
  formerName: string;
  formerSlug: string;
  people: Record<Role, { fullName: string; email: string }>;
  /** More named people, so the demo shows profiles with different views (a second partner and manager, a colleague with no clients). */
  extra: { key: string; role: Role; fullName: string; email: string }[];
}

const person = (slug: string, fullName: string) => ({ fullName, email: `${fullName.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}@${slug}.example.test` });

export const DEMO_FIRMS: DemoFirm[] = [
  {
    name: 'Kangethe & Associates', slug: 'kangethe', formerName: 'Demo Firm A', formerSlug: 'firm-a',
    people: {
      firm_admin: person('kangethe', 'Wanjiru Mugo'),
      partner: person('kangethe', 'Grace Kangethe'),
      manager: person('kangethe', 'Daniel Otieno'),
      senior: person('kangethe', 'Faith Njeri'),
      staff: person('kangethe', 'Brian Kiptoo'),
      quality_officer: person('kangethe', 'Mercy Achieng'),
      eqr: person('kangethe', 'Samuel Kariuki'),
    },
    extra: [
      { key: 'partner2', role: 'partner', ...person('kangethe', 'Charles Kamau') },
      { key: 'manager2', role: 'manager', ...person('kangethe', 'Ruth Wambui') },
      { key: 'staff2', role: 'staff', ...person('kangethe', 'Tom Odhiambo') },
    ],
  },
  {
    name: 'Waweru & Associates', slug: 'waweru', formerName: 'Demo Firm B', formerSlug: 'firm-b',
    people: {
      firm_admin: person('waweru', 'Peter Maina'),
      partner: person('waweru', 'Joseph Waweru'),
      manager: person('waweru', 'Esther Wairimu'),
      senior: person('waweru', 'Kevin Mutua'),
      staff: person('waweru', 'Lucy Chebet'),
      quality_officer: person('waweru', 'Hassan Abdi'),
      eqr: person('waweru', 'Alice Nduta'),
    },
    extra: [],
  },
];

/** The address an earlier seed gave to this role, for in-place migration. */
export const legacyEmail = (role: Role, slug: string): string => `${role.replace('_', '-')}@${slug}.example.test`;
