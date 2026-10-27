import type { Article } from '../src/types';

export const auditWork: Article[] = [
  {
    id: 'bank-statements-upload',
    title: 'Uploading and checking a bank statement',
    summary: 'Which files work, what the checks mean, passwords, and why a statement has to be confirmed before it is analysed.',
    category: 'Audit work',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['bank', 'statement', 'upload', 'pdf', 'csv', 'excel', 'password', 'scanned', 'mpesa', 'balance', 'confirm'],
    topics: ['engagement.bank-statements'],
    body: `Upload the client's bank statement on the engagement's **Bank statements** tab. The system reads it into dated entries and checks that nothing was missed.

## Which files work
A **PDF that has text in it** (the kind a bank emails or you download from internet banking), a **CSV** or an **Excel (.xlsx)** file. A **scanned PDF**, which is only a picture of paper, cannot be read and is refused: ask the client for the original download, or for a CSV or Excel export.

## Password-protected PDFs
Many banks protect statements with a password. Type it into the password box before you choose the file. It is used once to open the file and is never saved or logged.

## The check on every statement
The system adds the entries to the opening balance and compares the result with the closing balance. It also checks that each running balance follows from the entry before. You see one of three results:
- **Adds up**: every entry was read and the balances agree.
- **Does not add up**: an entry may be missing or misread. The screen shows the difference and the first place it breaks. Look at the first rows of the preview and compare them with the PDF.
- **Could not be checked**: the statement prints no balances, so there is nothing to check against.

## Confirming
Confirm a statement once you have looked at the preview. One that adds up is confirmed with a click. One that does not add up can still be confirmed, but you must give a reason, and the reason stays on the record. **Analysis only runs on a confirmed statement.** A confirmed statement cannot be changed or deleted; one you have not confirmed can be discarded and uploaded again.

## Who sees it
Only the engagement team, and partners for reading. The entries are stored encrypted, only the last four digits of the account number are kept, and opening a statement is recorded in the audit trail.

## If a statement will not read
Layouts differ between banks, and this reader has been tested on typical layouts. If yours is refused or reads wrongly, upload a CSV or Excel export instead and tell your administrator which bank it was, with a copy of the statement that has the names and account numbers blacked out.`,
  },
  {
    id: 'bank-statements-analysis',
    title: 'Reading the bank statement analysis',
    summary: 'What each observation means, reconciling to the books, and how the observations feed your checklists.',
    category: 'Audit work',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['bank', 'analysis', 'duplicate', 'returned', 'cheque', 'round', 'weekend', 'cut-off', 'overdraft', 'cash', 'related party', 'reconcile', 'going concern'],
    topics: ['engagement.bank-statements'],
    body: `The analysis points at entries worth a question. It never says something is wrong: it is a set of prompts, and you decide what each means.

## What you see
Money in and out for each month with the month-end balance, the largest entries each way, how much went through cash and mobile money, and a list of observations. Each observation shows the rows it is about.

## The observations
- **Possible duplicate**: the same date, description and amount more than once. Look at whether each was a real separate payment.
- **Returned or dishonoured item**: the description suggests a cheque or payment came back. Look at what it was for and whether it was settled. This feeds the going concern checklist.
- **Large entry on a weekend**: banks rarely process on weekends, so the date may not be the date the money moved.
- **Large entry near the end of the period**: look at cut-off.
- **Round sums**: common for salaries and transfers, but worth seeing what supports them.
- **Overdrawn days**: the account went negative. Look at the overdraft facility and any charges.
- **A name from the related party list**: type the names into the box, separated by commas. Any entry that mentions one is listed, and feeds the related parties checklist.

## Reconciling to the books
Type the bank balance from the trial balance or ledger into the box. The system compares it with the statement's closing balance and shows the difference, which you explain with reconciling items such as cheques not yet presented or deposits in transit.

## Using what you find
Write what you did about each observation in the working paper or checklist it belongs to. The analysis itself is not audit evidence of a conclusion: you are.`,
  },
  {
    id: 'sampling-using',
    title: 'Drawing a sample and recording the tests',
    summary: 'Choosing random, monetary-unit or top items from a population, recording results, and what the exception summary means.',
    category: 'Audit work',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['sampling', 'sample', 'vouching', 'random', 'monetary unit', 'top items', 'population', 'exception', 'seed', 'test', 'invoice'],
    topics: ['engagement.sampling'],
    body: `A sampling schedule records what you chose to test, how you chose it, and what each test found, so the selection can be explained and repeated.

## Preparing the population
Make a CSV or Excel file of everything the sample is drawn from, such as all payments or all invoices for the year. It needs a heading row with an **Amount** column, and ideally a **Reference** and a **Description** column. If any amount cannot be read the upload is refused and the rows are listed, because a population with rows missing would not be representative.

## Choosing the method
- **Random**: every item has the same chance. Good when the items are similar in size.
- **Monetary-unit**: items are chosen in proportion to their value, so large items are very likely to be picked. An item at least as large as the sampling interval is always selected and marked **key item**.
- **Top items**: the largest items, all tested. These are not a sample of the rest, so nothing is projected from them.

## Seed and fingerprint
The draw uses a seed. Leave it blank and the system makes one and records it. Anyone drawing from the same population with the same seed gets the same items. The schedule also keeps a fingerprint of the population, so you can show later that it was the same file.

## Recording results
Open the schedule and mark each item:
- **Supported**: you saw what you needed to. You can link the invoice or receipt you uploaded under **Evidence**.
- **Exception**: something was wrong. Enter the misstatement in KES and a note.
- **Not tested**: you could not test it. Give the reason.

Every result records who and when, and is in the audit trail. You can change a result while the engagement is open. A schedule with any result cannot be deleted. One with none can be discarded and drawn again.

## The summary
It counts what was found and shows the exception rate. For random and monetary-unit samples it also shows a simple projection of what the exceptions might mean across the population. It is an indication to help your judgement, not a conclusion: you decide whether it matters against materiality.`,
  },
];
