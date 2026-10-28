import type { Article } from '../src/types';

export const reviewAndApproval: Article[] = [
  {
    id: 'review-sign-off',
    title: 'Reviewing and signing off a paper',
    summary: 'Manager review, partner approval, and the rules that keep reviewers independent of the work.',
    category: 'Review and approval',
    audience: ['manager', 'partner'],
    tags: ['review', 'sign off', 'how to sign off', 'sign off a paper', 'signing off', 'approve', 'manager', 'partner', 'stale', 'separation of duties'],
    topics: ['paper.signoff', 'review'],
    body: `A paper moves through three levels: **Prepared**, **Reviewed** (manager) and **Approved** (partner).

## Manager review
1. Open the paper from your Today page: each paper waiting for you has an **Open** button.
2. Read it and its evidence. Raise review notes for anything unclear.
3. Sign off as **Reviewed**. You need a fresh authenticator code.

You must rank above the person who last edited the paper, and you cannot review work you prepared or edited.

## Partner approval
The partner signs off as **Approved** once the paper is reviewed and no review notes are open. The partner cannot be someone who has already signed the paper at another level.

## If the paper changes while you review
Sign-off is tied to the exact text you read. If the paper was edited after you opened it, the sign-off is refused as stale: reopen it and read the new version.

## After an edit
Any edit to a reviewed or approved paper cancels the manager and partner sign-offs. The history shows who signed what and when, including the cancelled ones.`,
  },
  {
    id: 'review-notes',
    title: 'Raising and clearing review notes',
    summary: 'Who can raise a note, who can clear it, and how open notes block approval.',
    category: 'Review and approval',
    audience: ['partner', 'manager', 'quality_officer', 'eqr', 'senior', 'staff'],
    tags: ['review note', 'query', 'clear', 'accept', 'open', 'comment', 'point'],
    topics: ['paper.review-notes', 'review-notes'],
    body: `A review note is a point a reviewer wants answered on a paper.

## Raising
Managers, partners, quality officers and engagement quality reviewers can raise a note on any paper of an engagement they are on.

## Answering
The preparer reads the note, changes the paper or explains, and replies.

## Clearing and accepting
- A manager, partner, quality officer or quality reviewer can **clear** a note when it is dealt with.
- Only a manager or partner can **accept** a note, which closes it with the point left as it is.
- Whoever last edited the paper cannot clear notes on it.

## Why it matters
A paper with an open note cannot get partner approval, and the engagement cannot move to partner approval while notes are open.`,
  },
  {
    id: 'engagement-stages',
    title: 'Moving an engagement through its stages',
    summary: 'The stages, who moves them and what must be true first.',
    category: 'Review and approval',
    audience: ['manager', 'partner'],
    tags: ['stage', 'transition', 'planning', 'fieldwork', 'completion', 'review', 'gate', 'blocked'],
    topics: ['engagement.stage', 'stages'],
    body: `An engagement moves forward one stage at a time: Onboarding, Planning, Fieldwork, Completion, Review, Partner approved, Report issued, Locked.

## What must be true first
- **To Planning**: the client acceptance paper is approved, an engagement letter is on file and everyone on the team has a current independence declaration.
- **To Fieldwork**: the materiality paper and the risk assessment are both reviewed and approved.
- **To Completion**: the checklists are created with every mandatory question answered, and a balanced trial balance is imported and mapped.
- **To Review**: every item on the disclosure checklist is satisfied.
- **To Partner approved**: all review notes are cleared or accepted, and where a quality review is required it has final sign-off.

## Who moves it
Managers and partners can move it to Planning through Review. Only the engagement partner approves, issues the report and locks, and each of those needs a fresh authenticator code.

## When it is blocked
The Overview lists exactly what is missing. Fix those and try again.`,
  },
  {
    id: 'approve-issue-lock',
    title: 'Approving, issuing the report and locking',
    summary: 'The partner\'s final steps and what locking means.',
    category: 'Review and approval',
    audience: ['partner'],
    tags: ['approve', 'issue', 'report', 'lock', 'lock the engagement', 'locking', 'report date', '60 days', 'partner'],
    topics: ['engagement.approve'],
    body: `These steps belong to the engagement partner.

## Approve
Move the engagement to **Partner approved** once review is complete. Enter your authenticator code when asked.

## Issue the report
Choose **Report issued** and enter the report date. The file must be assembled and locked within 60 days of that date.

## Lock the engagement
Locking makes the whole file immutable: no edit, no delete, no new sign-off. The system also locks it automatically when the 60 days pass.

## After locking
Late information goes in as an addendum paper. To change anything else, a partner requests an unlock with a reason and a different partner or the quality officer approves it. Both confirm with a code. The file then reopens for a short window and locks again.`,
  },
  {
    id: 'eqr-review',
    title: 'The engagement quality review',
    summary: 'What the quality reviewer does and signs.',
    category: 'Review and approval',
    audience: ['eqr', 'quality_officer', 'partner'],
    tags: ['eqr', 'quality review', 'isqm', 'independent review', 'quality officer'],
    topics: ['engagement.eqr'],
    body: `Some engagements need an independent quality review before the report is issued. An engagement is marked as needing one when it is opened, or when a partner assigns a reviewer.

## The reviewer
A partner assigns the reviewer, who joins the engagement team. The engagement partner cannot be the reviewer of their own engagement.

## What the reviewer signs
The reviewer works on the **quality review** paper and gives the final sign-off on it. This is the only paper where the reviewer's sign-off can stand in for the partner level.

## Why it matters
Where a review is required, the engagement cannot reach **Partner approved** until the quality review paper has its final sign-off.

## Raising points
The reviewer can raise review notes on any paper of the engagement. Open notes block approval until they are cleared.`,
  },
  {
    id: 'deleting-and-unlocking',
    title: 'Deleting papers and unlocking a file',
    summary: 'Why nothing is really deleted, and who must agree.',
    category: 'Review and approval',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['delete', 'remove', 'two person', 'approval', 'unlock', 'locked', 'immutable'],
    topics: ['paper.delete'],
    body: `The firm controls deletion and changes to reviewed documents.

## Deleting a paper
- You can delete your own **draft** or **prepared** paper. A manager or partner can delete any paper in those states. A reason is required.
- A paper that has been reviewed or approved needs a **second person**: you request the deletion and a more senior colleague approves it, with a fresh code.
- A deleted paper disappears from lists but stays in the history with who deleted it and why.

## Locked engagements
Nothing can be deleted or edited. See the guide on approving, issuing and locking.

## Unlocking
A partner asks with a reason. A different partner or the quality officer approves. Both confirm with a code. The file reopens for a short window and then locks again.`,
  },
  {
    id: 'partner-view-only',
    title: 'Viewing engagements you are not on',
    summary: 'A partner can read every engagement; changing one needs a place on its team.',
    category: 'Review and approval',
    audience: ['partner'],
    tags: ['view only', 'oversight', 'partner', 'read', 'team', 'not on'],
    topics: ['engagement.view-only'],
    body: `As a partner you can open any engagement of the firm. If you are not on its team, a banner says **view only**.

## What you can do
Read the roadmap, papers, versions, review notes, checklists, evidence and draft statements.

## What you cannot do
Edit, sign off, raise notes, delete, move the stage, add people or upload. Ask the manager to add you to the team if you need to work on it.

## The record
Everything you open is recorded in the audit trail, like anyone else's viewing.`,
  },
];
