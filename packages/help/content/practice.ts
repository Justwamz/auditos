import type { Article } from '../src/types';

export const practice: Article[] = [
  {
    id: 'pipeline-prospects',
    title: 'Tracking prospects in the pipeline',
    summary: 'Adding prospects, moving them along, winning and losing them, and who sees what.',
    category: 'Practice management',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['pipeline', 'prospect', 'lead', 'proposal', 'new client', 'convert', 'won', 'lost', 'fee', 'owner'],
    topics: ['pipeline'],
    body: `The pipeline tracks prospective clients from first contact until they sign or are lost. Each prospect has one owner, who is accountable for it.

## Adding a prospect
Open **Pipeline** and fill in the name, sector, contact, expected fee in KES and expected start. You own what you add. Managers and partners can add a prospect for a colleague by choosing the owner.

## The stages
**Lead**, then **Proposal sent**, then **Engagement letter sent**. Use **Move to** on the card, forwards or back. The totals at the top show how many prospects and how much expected fee sit in each stage.

## Losing a prospect
Choose **Lost…** and say why. A lost prospect is closed and cannot be changed.

## Winning a prospect
A manager or partner presses **Won: make a client**, enters the legal form and year end, and chooses the account manager. The prospect becomes a client once and is marked won. Then open an engagement for the client from **Engagements**.

## Handing a prospect to someone else
Managers and partners can hand a prospect to another person, with a reason. The previous owner no longer sees it.

## Who sees what
You see the prospects you own. Partners and managers see the whole pipeline. Everything done to a prospect is in the audit trail.`,
  },
  {
    id: 'calendar-using',
    title: 'Using the shared calendar',
    summary: 'Adding events, who can see them, and the dates that appear by themselves.',
    category: 'Practice management',
    audience: ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'],
    tags: ['calendar', 'schedule', 'meeting', 'fieldwork', 'leave', 'deadline', 'week', 'availability', 'invite'],
    topics: ['calendar'],
    body: `The calendar shows what the firm is doing, week by week, in Nairobi time.

## Adding an event
Fill in the title, kind (meeting, fieldwork, deadline, leave, training or other), date and times. Tick **All day** for leave or a full day at the client. You can link a client or an engagement and invite colleagues.

## Who sees an event
- You, and the people you invite.
- The team of an engagement you link the event to.
- Partners, who see every event.
- A manager, when you or someone you invite is on an engagement team with them.

Nobody else sees it, and the firm administrator sees only their own.

## Dates that appear by themselves
Year ends, report dates and the deadline to lock the file (60 days after the report date) show for the engagements you can see, marked with a diamond.

## Changing and cancelling
Only the person who made an event can change it. They, or a partner, can cancel it. A cancelled event leaves the calendar but stays in the audit trail.

## For managers and partners
Use **Show** to look at one person's week.`,
  },
  {
    id: 'change-account-manager',
    title: 'Changing a client\'s account manager',
    summary: 'Who can do it, what happens to access and what is recorded.',
    category: 'Practice management',
    audience: ['partner', 'admin'],
    tags: ['account manager', 'reassign', 'change manager', 'client', 'responsibility', 'handover'],
    topics: ['clients.manager'],
    body: `Every client has one account manager, who is accountable for the relationship. A partner or a person holding the administrator permission can change it.

## How
Open the client, find **Change the account manager**, choose another manager or partner, give a reason and press **Change**.

## What happens
- The new manager sees the client and its contacts.
- The previous manager no longer sees the client, unless they are on one of its engagement teams.
- The change, with both names and your reason, is written to the audit trail.

## Engagements
Engagement teams are not changed. Add or remove team members from the engagement.`,
  },
  {
    id: 'handover-leavers',
    title: 'When someone leaves: handing over their work',
    summary: 'Why a person cannot be switched off while they hold clients or prospects, and how to hand them over.',
    category: 'Administration',
    audience: ['admin'],
    tags: ['leaver', 'handover', 'switch off', 'deactivate', 'account manager', 'clients', 'prospects', 'resign'],
    topics: ['admin.handover'],
    body: `A person who manages clients or owns open prospects cannot be switched off, and cannot be moved to a role that cannot hold them, until their work has a new home.

## How to hand over
1. Open **People and access** and press **Hand over** on the person's row.
2. You see the clients they manage and the open prospects they own.
3. Choose who takes everything over. For clients it must be an active manager or partner.
4. Give a reason and press **Hand over**.

## What is recorded
One entry in the audit trail for the handover, and one for each client and prospect that moved, each with the reason.

## Then
Press **Switch off**. Their sessions end at once. Engagement team membership is separate: add and remove people on the engagements themselves.

## If the button says they still hold something
Closed prospects (won or lost) do not count. Reopen the Hand over panel to see what is left.`,
  },
];
