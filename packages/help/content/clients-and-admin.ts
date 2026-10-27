import type { Article } from '../src/types';

export const clientsAndAdmin: Article[] = [
  {
    id: 'clients-and-account-managers',
    title: 'Clients and their account managers',
    summary: 'Adding a client, the account manager and what it means.',
    category: 'Clients and privacy',
    audience: ['partner', 'manager', 'firm_admin'],
    tags: ['client', 'account manager', 'add client', 'sector', 'framework', 'relationship'],
    topics: ['clients.add'],
    body: `Every client has exactly one account manager: a manager or partner who is accountable for the relationship.

## Adding a client
Managers and partners can add a client from **Clients**. Enter the name, sector, legal form, reporting framework and year end. The account manager is you unless you pick another manager or partner.

## What the account manager can see
The client and its contacts, wherever they sit in the firm, even before any engagement is opened. Other people see the client only through an engagement team (or, for partners and administrators, because of their role).

## Opening an engagement
After adding a client, open an engagement for each financial year from **Engagements**. You can only open one for a client you can see.

## Changing the account manager
A partner or a person with the administrator permission can change it, with a reason. See "Changing a client's account manager".

## The list
The **Why you see it** column tells you whether you manage the client, are on its team, or see it as a partner or administrator.`,
  },
  {
    id: 'personal-details',
    title: 'Personal details are masked',
    summary: 'How phone numbers, emails, ID numbers and KRA PINs are hidden, and how to reveal one.',
    category: 'Clients and privacy',
    audience: ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'],
    tags: ['pii', 'privacy', 'mask', 'reveal', 'phone', 'email', 'id number', 'kra pin', 'data protection', 'contacts'],
    topics: ['clients.contacts', 'personal-details'],
    body: `The personal details of people at a client are protected. This follows the firm's duty under the Data Protection Act, 2019.

## What is hidden
Phone numbers, email addresses, ID numbers and KRA PINs show as masked values, for example **+••• ••• ••• 678**. They are stored encrypted, and the real value is not sent to your screen.

## How to reveal one
1. Open the client and find the contact.
2. Press **Reveal** beside the detail.
3. Write why you need it and press **Reveal and record**.

The value shows for 30 seconds and then hides again.

## What is recorded
Each reveal is written to the audit trail with your name, the detail, whose it is and your reason. People with access to the audit trail can read it. Reveal only what you need.

## Who can reveal
People who can see the client's file. The firm administrator role cannot, because it has no access to client content.`,
  },
  {
    id: 'audit-trail-reading',
    title: 'Reading the audit trail',
    summary: 'What is recorded, the filters, and who may open it.',
    category: 'Clients and privacy',
    audience: ['partner', 'manager', 'admin'],
    tags: ['audit trail', 'log', 'who viewed', 'activity', 'history', 'reveal', 'filter', 'accountability'],
    topics: ['audit-trail'],
    body: `The audit trail records what people do on client files, as a sentence: for example "Brian Kiptoo viewed the working paper "Stock count" for Mwangaza Traders Ltd".

## What is recorded
- Viewing a client, an engagement, a paper or the draft statements
- Creating, editing, deleting and moving papers, and every sign-off and its cancellation
- Downloading evidence and exporting statements
- Revealing a personal detail, with the reason given
- Signing in and out

Looking at the same thing again within five minutes is recorded once.

## Filters
Choose what to show (views, changes, revealed details, sign-ins), a person, a client and a date range. **Show older** loads earlier entries.

## Who sees what
Partners and people with the administrator permission see the whole firm. A manager sees the engagements they are on. Everyone else has no access.

## It cannot be changed
Entries cannot be edited or deleted. Each is chained to the one before it, so any tampering would show.`,
  },
  {
    id: 'people-and-access',
    title: 'Inviting people and giving access',
    summary: 'Named people only, roles, the administrator permission and switching access off.',
    category: 'Administration',
    audience: ['admin'],
    tags: ['invite', 'user', 'role', 'access', 'administrator', 'permission', 'switch off', 'named'],
    topics: ['admin.users'],
    body: `Open **People and access** to manage who can sign in.

## Every account is one named person
Enter the person's full name and personal email. Addresses that look shared, such as admin@, info@ or accounts@, are refused, because nobody can be held to account for a shared login.

## Inviting
1. Enter the full name and email, and choose a role.
2. Tick **Can manage people and access** only if they should administer.
3. Press **Create invite** and send the one-time link to the person. It works once and expires in 72 hours.

## Roles
Partner, manager, senior, staff, quality officer, engagement quality reviewer and firm administrator. A role decides what the person can do on engagements; the administrator permission is separate and can be given to a person in any role.

## Changing and switching off
Change a role in the list, give or take away the administrator permission, or switch access off. Switching off ends their sessions at once. You cannot switch yourself off, and the firm always keeps at least one administrator.

## What administrators cannot do
The firm administrator role cannot open engagement files or reveal clients' personal details.`,
  },
  {
    id: 'managing-an-engagement',
    title: 'Opening an engagement and building the team',
    summary: 'Opening an engagement for a client and year, risk flags and the team.',
    category: 'Administration',
    audience: ['manager', 'partner'],
    tags: ['engagement', 'open', 'team', 'members', 'risk flags', 'first year', 'independence', 'eqr'],
    topics: ['engagements.new'],
    body: `Managers and partners open engagements from **Engagements**.

## Opening one
1. Choose the client and the period.
2. Choose the engagement partner.
3. Tick the risk flags that apply: first-year engagement, fraud, going concern, or the need for a quality review. They add checklist questions and gates.
4. Press **Open engagement**.

You and the engagement partner both need a current independence declaration.

## The team
Add each person from the **Team** list on the Overview. They also need an independence declaration before they can join. People who are not on the team cannot see the engagement, except partners, who can read it.

## Next
Open the engagement and follow the roadmap. The first step creates the checklists.`,
  },
  {
    id: 'independence-declaration',
    title: 'Your independence declaration',
    summary: 'Why you need one and how to give it.',
    category: 'Getting started',
    audience: ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'],
    tags: ['independence', 'declaration', 'ethics', 'threats', 'safeguards', 'isqm'],
    topics: ['independence'],
    body: `You must declare your independence before you can be added to an engagement team, and the engagement cannot move to planning without a current declaration from everyone on it.

## How
Open **Independence**, write your declaration, list any threats and the safeguards applied, and save it.

## When it applies
A general declaration covers the firm's engagements. If a relationship affects one client, say so and describe the safeguards, and tell the manager.`,
  },
];
