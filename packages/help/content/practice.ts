import type { Article } from '../src/types';

export const practice: Article[] = [
  {
    id: 'pipeline-prospects',
    title: 'Tracking prospects',
    summary: 'The Prospects page: the table and the cards, filters, moving prospects along, winning and losing them, and who sees what.',
    category: 'Practice management',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['prospects', 'pipeline', 'prospect', 'lead', 'proposal', 'new client', 'convert', 'won', 'lost', 'fee', 'owner', 'table', 'cards', 'filter'],
    topics: ['pipeline'],
    body: `Prospects tracks prospective clients from first contact until they sign or are lost. Each prospect has one owner, who is accountable for it.

## The table and the cards
Prospects opens as a table with one row for each prospect: the name, its stage, the expected fee, the expected start and the owner. Choose **Cards** above the list to see the same prospects as cards instead, and **Table** to go back. The page remembers your choice.

## Finding a prospect
- The stage buttons at the top show **All open** or only one stage, with how many prospects are in each.
- Type in **Search prospects** to find a name or an owner.
- Managers and partners also have **Show prospects of**, to look at one person's prospects or **Everyone**. The totals by person are on the page too.
- Won and lost prospects are counted next to the stage buttons and listed under Closed.

## Opening a row
Click a row to open it in place and see the sector, the contact, the notes and the actions: **Move to**, **Hand over** and **Make a client**. The **...** button at the end of the row offers the same actions.

## Adding a prospect
Choose **+ Add a prospect** and fill in the name, sector, contact, expected fee in KES and expected start. You own what you add. Managers and partners can add a prospect for a colleague by choosing the owner.

## The stages
**Lead**, then **Proposal sent**, then **Engagement letter sent**. Use **Move to** on the row or the card, forwards or back.

## Losing a prospect
Choose **Lost...** under **Move to** (or **Mark as lost** in the **...** menu) and say why. A lost prospect is closed and cannot be changed.

## Winning a prospect
A manager or partner chooses **Make a client**, enters the legal form and year end, and chooses the account manager. The prospect becomes a client once and is marked won. Then open an engagement for the client from **Engagements**.

## Handing a prospect to someone else
Managers and partners can hand a prospect to another person, with a reason. The previous owner no longer sees it.

## Who sees what
You see the prospects you own. Partners and managers see all of them. Everything done to a prospect is in the activity history.`,
  },
  {
    id: 'calendar-using',
    title: 'Using the shared calendar',
    summary: 'Month, Day, Work week and Week views, adding events, seeing colleagues, and the dates that appear by themselves.',
    category: 'Practice management',
    audience: ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'],
    tags: ['calendar', 'schedule', 'meeting', 'fieldwork', 'leave', 'deadline', 'week', 'day', 'month', 'availability', 'invite', 'by person'],
    topics: ['calendar'],
    body: `The calendar shows what the firm is doing, in Nairobi time.

## The four views
Choose **Month**, **Day**, **Work week** (Monday to Friday) or **Week** (all seven days) above the calendar. The arrows move to the previous or next month, week or day, and **Today** brings you back. In Month, click a day to see its events in the panel beside it. In the other views, events sit on an hourly grid and you click one to open it.

## What to show
The **What to show** buttons switch each kind of event on or off: meetings, fieldwork, deadlines, leave, training and other. Every event also carries its kind in words or a symbol, so colour is never the only clue.

## Adding an event
Choose **+ New event** and fill in the title, kind, date and times. Tick **All day** for leave or a full day at the client. You can link a client or an engagement and invite colleagues.

## Who sees an event
- You, and the people you invite.
- The team of an engagement you link the event to.
- Partners, who see every event.
- A manager, when you or someone you invite is on an engagement team with them.

Nobody else sees it, and the firm administrator sees only their own.

## Dates that appear by themselves
Year ends, report dates and the deadline to lock the file (60 days after the report date) show for the engagements you can see, marked with a diamond.

## Changing and cancelling
Only the person who made an event can change it. They, or a partner, can cancel it. A cancelled event leaves the calendar but stays in the activity history.

## For managers and partners
Use **Show** to look at one person's calendar. **See by person** puts a day side by side, one column for each colleague.`,
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
- The change, with both names and your reason, is written to the activity history.

## Engagements
Engagement teams are not changed. Add or remove team members from the engagement.`,
  },
  {
    id: 'handover-leavers',
    title: 'When someone leaves: handing over their work',
    summary: 'Why a person cannot be paused while they hold clients or prospects, and how to hand them over.',
    category: 'Administration',
    audience: ['admin'],
    tags: ['leaver', 'handover', 'switch off', 'pause access', 'deactivate', 'account manager', 'clients', 'prospects', 'resign'],
    topics: ['admin.handover'],
    body: `A person who manages clients or owns open prospects cannot have their access paused, and cannot be moved to a role that cannot hold them, until their work has a new home.

## How to hand over
1. Open **People** and choose **Hand over** from the **...** menu on the person's row.
2. You see the clients they manage and the open prospects they own.
3. Choose who takes everything over. For clients it must be an active manager or partner.
4. Give a reason and press **Hand over**.

## What is recorded
One entry in the activity history for the handover, and one for each client and prospect that moved, each with the reason.

## Then
Open the **...** menu on their row and choose **Pause access**. They are signed out at once. Engagement team membership is separate: add and remove people on the engagements themselves.

## If the button says they still hold something
Closed prospects (won or lost) do not count. Reopen the Hand over panel to see what is left.`,
  },
];
