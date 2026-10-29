import type { Article } from '../src/types';

export const gettingStarted: Article[] = [
  {
    id: 'start-here',
    title: 'Start here: finding your way around',
    summary: 'What AuditOS is, what the menu holds and where to begin each day.',
    category: 'Getting started',
    audience: ['all'],
    tags: ['menu', 'dashboard', 'begin', 'overview'],
    topics: ['dashboard'],
    body: `AuditOS is where the firm plans, performs, reviews and reports its audits. Every action on a client file is recorded, and nothing that has been reviewed can be changed quietly.

## Your Today page
Today opens with a greeting and a list of what needs you, each with an **Open** button: papers waiting for your review, your own drafts, overdue invoices and dates coming up. Below it are your engagements and **What you can see**: your role, the clients you manage, the clients you see through an engagement team, and why.

## The menu
- **Today**: what needs you and what you can see.
- **Engagements**: one per client per financial year. Open one to see its roadmap, papers, checklists, evidence and draft financial statements.
- **Clients**: the clients you can see, with their contacts.
- **Independence**: your independence declaration, which you need before joining a team.
- **Activity history**: who did what, in plain English. Partners, managers and people with the administrator permission see it.
- **People**: for people who hold the administrator permission.
- **Help**: this section.

## Where to begin on an engagement
Open the engagement. The **Audit roadmap** at the top shows the steps in the order the firm works and one highlighted next step. Press its button and it takes you to the right place.`,
  },
  {
    id: 'who-sees-what',
    title: 'Who can see which clients and engagements',
    summary: 'The rules for visibility, by role, in plain words.',
    category: 'Getting started',
    audience: ['all'],
    tags: ['visibility', 'access', 'roles', 'clients', 'engagements', 'assigned', 'permissions'],
    topics: ['clients', 'who-sees-what'],
    body: `You only see what your work needs. The rules are enforced by the database, not just hidden on screen.

## Partners
A partner sees every client of the firm and can read every engagement. A partner can change only the engagements they are on the team of. An engagement you can read but are not on is marked **view only**.

## Managers
A manager sees the clients they manage (as account manager) and the clients whose engagement teams they are on.

## Seniors, staff, quality officers and quality reviewers
You see only the clients whose engagement teams you are on. If you are on no team you see no clients. Ask a manager to add you.

## Administrators
A person holding the administrator permission, and the firm administrator, can see the client list and manage people and access. The firm administrator role cannot open engagement files or reveal clients' personal details.

## Why can I not see a client?
Either you are not on a team for that client, or you are not its account manager. See "I cannot see a client or engagement".`,
  },
  {
    id: 'sign-in-and-codes',
    title: 'Signing in and your sign-in code',
    summary: 'Your password, the six-digit code and when you are asked for a fresh one.',
    category: 'Getting started',
    audience: ['all'],
    tags: ['password', 'code app', 'code', 'two-step', 'step-up', 'login', 'security'],
    topics: ['login', 'step-up'],
    body: `You sign in with your password and a six-digit code from the code app on your phone.

## Fresh codes for important actions
Some actions ask for a new code even though you are signed in: signing off a paper, approving a deletion, approving or issuing the engagement, locking and unlocking, and exporting statements. A code you gave within the last five minutes is still good.

## Staying signed in
You are signed out after 30 minutes without activity, and after 12 hours in any case.

## Locked out
Five wrong attempts lock the account for 15 minutes and sign the person out everywhere. Wait, or ask a person with the administrator permission.

## One person, one account
Every account belongs to one named person. Never share your password or your sign-in code. What you do is recorded under your name.`,
  },
  {
    id: 'audit-roadmap',
    title: 'The audit roadmap and the next step',
    summary: 'The eight steps of an engagement and how the next step is chosen.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'],
    tags: ['roadmap', 'steps', 'next step', 'progress', 'process', 'workflow'],
    topics: ['engagement.overview', 'roadmap'],
    body: `The roadmap on an engagement's Overview follows the firm's own process.

## The steps
1. **Accept the client and sign the engagement letter**: acceptance checks and the signed letter on file.
2. **Pre-planning meeting**: the auditor and the manager agree the team, timetable, time budget and risk areas.
3. **Pre-audit meeting with the client**: operations, or what changed, and the client's systems.
4. **Plan the audit**: materiality, risk assessment and the response to each risk.
5. **Fieldwork**: laws and regulations, related parties, IT, journals, opening balances, going concern and the trial balance.
6. **Complete the file**: subsequent events, representations and final checks.
7. **Review and approval**.
8. **Issue the report**.

## The next step
The first step that is not finished is highlighted, with a button that names the exact thing missing: for example "Answer the 3 required questions" or "Calculate materiality". A step is never shown as done while a required checklist question is still open.

## First time on an engagement
If the checklists have not been created, the first button reads **Start the checklists**. It creates them from the client's sector and the engagement's risk flags.`,
  },
  {
    id: 'checklists-answering',
    title: 'Answering checklists',
    summary: 'Yes, no or not applicable, the written reason, and mandatory questions.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['checklist', 'answer', 'mandatory', 'rationale', 'isa', 'icpak', 'questions'],
    topics: ['engagement.checklists', 'checklists'],
    body: `Checklists turn the standards into short questions. Each question shows the standard it comes from, such as ISA 315 or ISA 570.

## Answering
- Choose **Yes**, **No** or **Not applicable**.
- For **No** and **Not applicable** you must write a short reason (at least five characters). A **Yes** can stand on its own.
- Questions marked * are mandatory. The engagement cannot leave fieldwork until every mandatory question is answered.

## Where the checklists come from
They depend on the client's sector, the framework and the risk flags chosen when the engagement was opened. Adding a flag such as fraud or going concern adds the extra questions.

## The wording
The checklist wording is draft text until the firm's reviewer has approved it. Use your judgement and ask the manager when a question does not fit the client.

## Changing an answer
You can change an answer while the paper is not locked. Each change is a new version and can be compared in the history.`,
  },
  {
    id: 'checklists-last-year',
    title: 'Reusing last year\'s answers',
    summary: 'For a returning client, last year\'s answers are suggested and you confirm what has not changed.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['prior year', 'carry forward', 'same as last year', 'returning client', 'suggestions'],
    topics: ['checklists.prior'],
    body: `When a client has an earlier engagement, the new checklists show last year's answer under each question: **Last year: Yes**, with the reason if there was one.

## What it does
- The suggestion never counts as an answer. The question stays open until you answer it.
- **Same as last year** records last year's answer as this year's, with its reason. It follows the same rules as any answer and is saved as a version.
- If something has changed, answer the question normally.

## When there is no suggestion
A new client, or a question that was not on last year's checklist, has no suggestion.

## Good practice
Confirm only what you have checked has not changed. Ask the client about changes in operations, people, systems and financing, as the pre-audit meeting checklist prompts.`,
  },
  {
    id: 'materiality',
    title: 'Calculating materiality',
    summary: 'Benchmark, percentage, performance materiality and the clearly trivial threshold.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['materiality', 'benchmark', 'performance', 'trivial', 'isa 320', 'planning', 'percentage'],
    topics: ['engagement.papers.materiality', 'materiality'],
    body: `Materiality is set at planning in the **Working papers** tab.

## How to calculate
1. Choose a benchmark: revenue, total assets, profit before tax, total expenses or equity.
2. Enter the benchmark amount for the year in KES.
3. Enter the percentage of the benchmark (above 0 and at most 20).
4. Leave performance materiality at 75% of overall and clearly trivial at 5% of overall, or change them.
5. Write why this benchmark and percentage suit the client (at least ten characters).
6. Press **Calculate and save**.

## What you get
Three amounts in KES: overall materiality, performance materiality and the clearly trivial threshold. They are rounded down to whole cents.

## Changing it later
Recalculating saves a new version of the same paper. If the paper was already reviewed, the reviews are cancelled and it goes back for review.`,
  },
  {
    id: 'papers-prepare',
    title: 'Preparing a working paper',
    summary: 'Creating a paper, writing it up and marking it prepared.',
    category: 'Working on an audit',
    audience: ['senior', 'staff'],
    tags: ['paper', 'working paper', 'prepare', 'draft', 'sign off', 'prepared'],
    topics: ['engagement.papers', 'paper.edit'],
    body: `A working paper records one piece of audit work.

## Create and write
1. In **Working papers**, choose a type, give it a title and press **Add paper**.
2. Open it and write your notes. Save.
3. Attach evidence in the **Evidence** tab and refer to it from the paper or checklist.

## Mark it prepared
When it is complete, sign it off as **Prepared** (you will be asked for a fresh sign-in code). The paper then goes to the manager for review.

## If you edit afterwards
Editing a paper that the manager or partner has already signed off cancels their sign-offs, and the paper goes back for review. Your own prepared sign-off stays. The old text is kept in the history.

## Deleting
You can delete your own draft or prepared paper with a reason. Papers that have been reviewed need a second person to approve the deletion. Nothing is ever erased: it stays in the history.`,
  },
  {
    id: 'evidence-files',
    title: 'Uploading and using evidence',
    summary: 'What can be uploaded, how files are protected and how to refer to them.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['evidence', 'upload', 'file', 'pdf', 'receipt', 'statement', 'attach'],
    topics: ['engagement.evidence', 'evidence'],
    body: `Evidence is the supporting documents for the work: confirmations, statements, receipts, contracts.

## Uploading
In the **Evidence** tab, choose a file. PDF, PNG, JPG, XLSX, DOCX and CSV files up to 25 MB are accepted. The system checks that the file really is what its name says.

## How it is protected
- A tamper check of the file is recorded when it is uploaded and run again on every download, so any change is noticed.
- An evidence file can never be edited or replaced. To correct it, upload a new one.
- Every download is recorded in the activity history.

## Using it
You can link evidence to a checklist answer, so the reviewer can go from the question to the document.

## Receipts and vouching
For a client's receipts such as fuel or stationery, upload the ones you tested as evidence and note what you found in the working paper. You do not need to capture every receipt.`,
  },
  {
    id: 'version-history',
    title: 'Version history and going back',
    summary: 'See every saved version, what changed, and restore an older one.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['history', 'version', 'changes', 'restore', 'undo', 'compare', 'tracker'],
    topics: ['paper.history', 'version-history'],
    body: `Every time a paper is saved, a new version is kept. Versions cannot be changed or deleted by anyone.

## Reading the history
Open a paper and choose **Show history**. For each version you see who saved it, when and why. **What changed** lists the fields that moved, with the old text struck through and the new text beside it.

## Going back
**Go back to this** creates a new version with the old content and records your reason. Nothing is erased: the history now shows both the change and the return.

## Sign-offs and going back
Going back is an edit. Manager and partner sign-offs on the paper are cancelled, and it returns for review.

## Locked engagements
When the engagement is locked, nothing can be changed or restored. Late information goes in as an addendum.`,
  },
  {
    id: 'draft-financial-statements',
    title: 'Drafting the financial statements',
    summary: 'From trial balance to draft IFRS for SMEs statements and exports.',
    category: 'Working on an audit',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['financial statements', 'trial balance', 'mapping', 'adjustments', 'ifrs for smes', 'draft', 'export', 'comparatives'],
    topics: ['engagement.financials', 'financials'],
    body: `The **Financial statements** tab builds a draft set from the trial balance.

## Steps
1. **Import** the trial balance (CSV or Excel). The system checks it balances.
2. **Map** every account to a statement line. Suggestions are offered; you confirm them.
3. **Adjust**: record audit adjustments as proposed, agreed or unadjusted. Only a manager or partner can agree one.
4. **Read** the statement of financial position, profit or loss, changes in equity, cash flows and the disclosure checklist.

## Comparatives
For a client with an earlier engagement, use **carry forward** to bring last year's adjusted balances and mapping as comparatives. A first-year client shows no comparatives and a note says so.

## Which standard
IFRS for SMEs applies. The second edition applies to periods beginning before 1 January 2027 and the third edition after. Full IFRS statements are not available yet.

## Exports
You can export Word, Excel or PDF. Exports are marked DRAFT until the engagement is approved. Exporting asks for a fresh sign-in code and is recorded.

Exported statements carry your firm's letterhead: in Word and PDF your logo (if you added one), firm name and contact details at the top, and your footer note at the bottom. In Excel the first row of each sheet holds the firm name and contact details and the last row holds the footer. "Powered by AuditOS" always prints at the bottom, and no setting removes it. Unlike invoices and quotations, statements are not frozen: an export always uses your branding as it is today. If a logo cannot be read, the logo is left out and the rest of the letterhead still prints.`,
  },
];
