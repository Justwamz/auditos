import type { Article } from '../src/types';

export const troubleshooting: Article[] = [
  {
    id: 'cannot-see-client',
    title: 'I cannot see a client or engagement',
    summary: 'The usual reasons and what to do.',
    category: 'When something goes wrong',
    audience: ['all'],
    tags: ['cannot see', 'missing', 'not found', 'no clients', 'access', 'assigned', '404'],
    topics: ['clients.empty'],
    body: `AuditOS shows only what your work needs. A client or engagement that is missing is almost always a matter of assignment.

## Check these
1. **Are you on the team?** Seniors, staff, quality officers and reviewers see a client only through an engagement team. Ask the manager to add you.
2. **Are you the account manager?** Managers see the clients they manage and the clients they are on teams for.
3. **Are you a partner?** You see every client and can read every engagement, but changing one needs a place on its team.
4. **Are you the firm administrator?** You see the client list and manage people, but you cannot open engagement files.

## Still not there?
A page that says "could not be found" is the same whether the item does not exist or you may not see it. Ask your manager or the account manager.`,
  },
  {
    id: 'cannot-sign-off',
    title: 'Why can I not sign off this paper?',
    summary: 'The reasons a sign-off is refused.',
    category: 'When something goes wrong',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['sign off refused', 'stale', 'own work', 'open notes', 'grade', 'cannot approve', 'error'],
    topics: ['paper.signoff-blocked'],
    body: `A sign-off can be refused. Find your case below.

## The usual reasons
- **Wrong order.** Papers go Prepared, then Reviewed, then Approved. You cannot skip a level.
- **The paper changed.** The paper was edited after you opened it. Reopen it, read the new version and sign again.
- **Your own work.** You cannot review a paper you prepared or edited, or approve one you already signed at another level.
- **Rank.** A manager review needs a reviewer who ranks above the person who last edited the paper.
- **Role.** Only managers and partners review; only partners approve (the quality reviewer signs the quality review paper).
- **Open review notes.** Partner approval waits until every note is cleared or accepted.
- **Locked.** A locked engagement accepts no sign-offs.
- **Fresh code.** You need an authenticator code from the last five minutes.
- **View only.** A partner who is not on the team can read the paper but not sign it.`,
  },
  {
    id: 'cannot-move-stage',
    title: 'Why will the engagement not move to the next stage?',
    summary: 'What the stage checks mean and how to clear them.',
    category: 'When something goes wrong',
    audience: ['partner', 'manager'],
    tags: ['blocked', 'gate', 'stage', 'cannot move', 'planning', 'fieldwork', 'completion', 'review'],
    topics: ['engagement.blocked'],
    body: `When a move is refused, the Overview lists what is missing.

## What each message means
- **The client acceptance paper needs partner approval.** Get it reviewed and approved.
- **Add an engagement letter paper.** Record the signed letter.
- **Everyone on the team needs a current independence declaration.** Ask the person to declare.
- **The materiality paper needs manager and partner approval.**
- **The risk assessment paper needs manager and partner approval.**
- **Generate the checklists and answer every mandatory question.** Use the roadmap's next step.
- **Import a balanced trial balance and map every account.** Do this in Financial statements.
- **Complete every item on the disclosure checklist.**
- **Clear or accept all open review notes.**
- **The engagement quality review needs final sign-off.**

The partner steps (approve, issue, lock) can only be taken by the engagement partner with a fresh code.`,
  },
  {
    id: 'locked-out',
    title: 'I cannot sign in',
    summary: 'Wrong password, lockout and codes that are refused.',
    category: 'When something goes wrong',
    audience: ['all'],
    tags: ['login', 'locked', 'password', 'code', 'authenticator', 'cannot sign in', 'invalid'],
    topics: ['login.help'],
    body: `## Check
- The email and password are exactly right. The message does not say which is wrong, on purpose.
- Your phone's clock is correct. Authenticator codes depend on it.
- You are not reusing a code. Each code works once; wait for the next one.

## Locked
After five wrong attempts the account is locked for 15 minutes and its sessions end. Wait, then try again.

## Still stuck
Ask a person in your firm who holds the administrator permission. They can check your access under **People and access**.`,
  },
  {
    id: 'export-asks-for-code',
    title: 'Why am I asked for a code again?',
    summary: 'Important actions need a fresh authenticator code.',
    category: 'When something goes wrong',
    audience: ['all'],
    tags: ['code again', 'step up', 'fresh code', 'confirm', 'dialog'],
    topics: [],
    body: `Some actions ask for a new code even though you are signed in.

## Which actions
Signing off, approving a deletion, approving, issuing or locking an engagement, unlocking, and exporting statements each need a code from the last five minutes. This protects the file if a screen is left open.

## What to do
Enter the current code from your authenticator. If you gave one a few minutes ago, you will not be asked again until five minutes have passed. A code can be used only once, so if it is refused, wait for the next one.`,
  },
];
