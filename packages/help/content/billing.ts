import type { Article } from '../src/types';

export const billing: Article[] = [
  {
    id: 'timesheet-time-expenses',
    title: 'Logging your time and expenses',
    summary: 'Recording hours and job expenses, what is billable, and why entries freeze once invoiced.',
    category: 'Time and billing',
    audience: ['partner', 'manager', 'senior', 'staff'],
    tags: ['timesheet', 'time', 'hours', 'expenses', 'receipts', 'billable', 'fuel', 'log time', 'utilisation'],
    topics: ['timesheet'],
    body: `The **Timesheet** is where you record what you do, week by week.

## Logging time
1. Choose the date and the engagement. Choose **Firm time** for work that is not for a client, such as training or a staff meeting.
2. Enter the time as hours (1.5) or as 1:30, and what you did.
3. Leave **Billable to the client** ticked when the client should pay for it.

Time with no engagement is never billable. You can log time only on engagements you are on the team of.

## The rate is fixed when you log
The firm's hourly rate for your role is stamped on the entry at that moment. If the firm changes its rates later, entries you already logged keep the old rate. You do not see rates or values; managers and partners do.

## Changing and deleting
You can change or delete your own entries until they are put on an invoice. After that they are frozen. If an invoice is voided, they become editable again.

## Expenses
Use **Record an expense** for costs you incur for a job, such as fuel to the client's premises. Choose the category, amount and whether to add it to the client's invoice. Keep the receipt and attach it as evidence on the engagement.

## A client's own receipts
Receipts a client gives you (their fuel, stationery) are audit evidence, not entries here. Upload the ones you test as evidence and note the result in the working paper.`,
  },
  {
    id: 'billing-dashboard',
    title: 'Reading the billing summary',
    summary: 'Hours, utilisation, work in progress, invoices and what is owed, and who sees which figures.',
    category: 'Time and billing',
    audience: ['partner', 'manager', 'admin'],
    tags: ['billing', 'dashboard', 'summary', 'utilisation', 'work in progress', 'wip', 'overdue', 'outstanding', 'collected', 'budget'],
    topics: ['billing'],
    body: `**Billing** shows how the firm is doing on time and money for the period you choose. The tabs along the top take you to **Overview**, **Invoices**, **Quotations**, **Sent emails** and, for partners and administrators, **Settings**.

## What you see
- **Partners** see the whole firm.
- **Managers** see the engagements they are on, including their team's time.
- **People with the administrator permission** see invoicing, not hours or values.
- Staff and seniors see only their own hours on the Timesheet.

## The figures
- **Invoiced in this period**: invoices issued between the dates.
- **Collected**: payments received between the dates.
- **Still owed**: issued invoices not yet fully paid, and **Overdue** the part past its due date.
- **Hours logged** and **Utilisation**: the share of logged hours that were billable.
- **Billable value**: billable hours at the rate when they were logged.
- **Not yet invoiced**: billable time and rebillable expenses not on any issued invoice (work in progress).
- **Open prospects**: expected fees of prospects not yet won or lost.

## By engagement and by person
Below the figures, two tables follow: **By engagement** and **By person**. By engagement shows hours against the budget, and the fee arrangement. A fixed-fee job shows the fee and the value of time spent, so you can see whether the job is paying.`,
  },
  {
    id: 'invoices-and-tax',
    title: 'Making, issuing and collecting an invoice',
    summary: 'Drafting from time, expenses or the fixed fee, choosing tax per invoice, issuing, payments and voiding.',
    category: 'Time and billing',
    audience: ['partner', 'manager', 'admin'],
    tags: ['invoice', 'add vat to an invoice', 'vat on an invoice', 'invoice tax', 'tax', 'vat', 'excise', 'inclusive', 'exclusive', 'issue', 'payment', 'void', 'number', 'draft', 'overdue'],
    topics: ['invoices'],
    body: `## Drafting
Press **+ New invoice**. Choose the client. To bill work, choose the engagement too and tick the time, expenses and the fixed fee you want on this invoice. You can add lines of your own. Time is grouped by person at the rate it was logged.

## Tax is your choice, per invoice
No tax is added unless you choose it. Choose any of the firm's taxes (up to five), and say whether your prices are **before tax** (the tax is added) or **already include tax** (the tax is worked out of them). Where a tax is charged on top of another, such as VAT on top of excise duty, the order you tick them in is the order they are applied. Totals are exact to the cent either way.

## Issuing
A partner or a person with the administrator permission issues the invoice. Issuing gives it the next number, with no gaps, marks the time and expenses as billed, and locks the invoice: lines, taxes and totals can never change.

## Letterhead
The top of the invoice, on screen and on the PDF, shows your firm's logo (or its name), address, phone, email, website and KRA PIN. These come from **Billing settings** and from the **Branding** page. Your footer note and bank details print on the PDF only. When you issue an invoice, the letterhead is copied onto it and frozen, so changing your name, address, logo or colour later does not alter invoices already issued. A draft always shows the current letterhead. Invoices issued before this was kept show your current details. "Powered by AuditOS" is part of the letterhead on screen, at the bottom of every PDF page, and in the emails kept in **Sent emails**.

## Tax authority submission
Until KRA is connected, issued invoices are for **practice only**: they carry a "practice" tag in the list and a **PRACTICE ONLY** warning on screen, and the PDF is marked as not valid too. They are not valid tax invoices. See "Tax invoices and the KRA practice mode".

## Payments
Press **Record payment**, then enter the date, method and amount. A part payment makes the invoice **Part paid**; the full amount makes it **Paid**. Past the due date and not fully paid, it shows as **Overdue**.

## If it is wrong
Open the **...** menu and choose **Void this invoice**, with a reason. The time and expenses become billable again and you issue a new invoice. An invoice that has received a payment cannot be voided.

## Sending
**Send to the client** keeps an email in the **Sent emails** tab. Email is not connected, so each one says **Not actually sent (practice mode)**.`,
  },
  {
    id: 'quotations-using',
    title: 'Quotations',
    summary: 'Pricing a job for a client or prospect, sending, acceptance and turning it into the fixed fee.',
    category: 'Time and billing',
    audience: ['partner', 'manager', 'admin'],
    tags: ['quotation', 'quote', 'proposal', 'price', 'fee', 'accept', 'prospect', 'tax'],
    topics: ['quotes'],
    body: `A quotation prices a job before the engagement exists.

## Making one
Press **+ New quotation**. Choose a client or a prospect, give it a title and an optional validity date, add lines, and choose any taxes and whether prices include them, as on an invoice.

## Sending
**Send and number it** gives it the next quotation number and locks it. If you give an email address, a message is kept in the **Sent emails** tab; email is not connected, so it is not actually sent (practice mode).

## Letterhead
A quotation shows your firm's letterhead (logo or name, address, phone, email, website and KRA PIN) on screen and on the PDF, taken from **Billing settings** and the **Branding** page. Your footer note and bank details print on the PDF only. When you send and number it, the letterhead is copied onto the quotation and frozen, so later changes to your branding do not alter it. "Powered by AuditOS" is part of the letterhead on screen and at the bottom of every PDF page.

## Acceptance
Record whether the client accepted or declined. Each can be recorded once.

## Using the fee
When a quotation for a client is accepted, a manager or partner on the engagement can **Set the fee**. The engagement then has a fixed fee equal to the quotation amount before tax, which you can bill from the engagement.

## Who sees quotations
Managers, partners and people with the administrator permission. Staff do not.`,
  },
  {
    id: 'rates-taxes-settings',
    title: 'Hourly rates, taxes and invoice details',
    summary: 'Setting the firm\'s rates by role, the list of taxes, and what appears on invoices.',
    category: 'Time and billing',
    audience: ['partner', 'admin', 'manager'],
    tags: ['rates', 'hourly rate', 'tax', 'vat', 'settings', 'invoice details', 'prefix', 'kra pin', 'bank', 'payment terms'],
    topics: ['billing.settings'],
    body: `Open **Billing**, then the **Settings** tab. It has three sections you open one at a time: **Hourly rates**, **Taxes** and **Invoice details**, each with its own Save button. Partners and people with the administrator permission change them; managers can read them.

## Hourly rates
Set a rate in KES for each role. A rate applies to time logged from then on; time already logged keeps the rate it had.

## Taxes
The list holds the taxes that can be put on an invoice or quotation, for example VAT at 16%. Mark a tax as **charged on top of the tax before it** for cases such as VAT on excise duty. A tax can be switched off but never deleted, so old invoices stay readable. Nothing from the list is applied unless someone chooses it on a document.

## Invoice details
The firm's name, address, KRA PIN and bank details print on invoices and quotations, as part of the letterhead that is frozen when a document is issued or sent. The number prefixes (for example KA gives KA-2026-0001) and the days allowed for payment are set here. The logo, phone, email, website, footer note and colours are set by the firm administrator on the **Branding** page (see **Set your firm's logo and colours**).

## Changes are recorded
Every change to rates, taxes and details is in the activity history.`,
  },
  {
    id: 'fees-flat-or-hourly',
    title: 'Fixed fee or hourly: setting how a job is billed',
    summary: 'The fee arrangement and budget of an engagement, and billing a fixed fee.',
    category: 'Time and billing',
    audience: ['partner', 'manager'],
    tags: ['fee', 'flat fee', 'fixed fee', 'hourly', 'budget', 'engagement fee', 'billing basis'],
    topics: ['billing.fee'],
    body: `Every engagement can have a fee arrangement. Find it on the engagement's **Overview**.

## By the hour
Time is billed at the firm's rates. Set a budget in hours if you want to watch the job against it.

## Fixed fee
Enter the fee in KES before tax. It does not depend on hours. When you make an invoice for the engagement, tick **Bill the fixed fee**. Time logged still counts toward the budget and the value shown on the billing summary, so you can see whether the job is paying.

## Who can set it
A manager or partner on the engagement team. Partners who are not on the team can read it.

## From a quotation
An accepted quotation can set the fixed fee for you.`,
  },
  {
    id: 'kra-etims-simulation',
    title: 'Tax invoices and the KRA practice mode',
    summary: 'What practice mode means and what is needed before invoices count as tax invoices.',
    category: 'Time and billing',
    audience: ['partner', 'manager', 'admin'],
    tags: ['kra', 'etims', 'tax invoice', 'control number', 'practice', 'practice only', 'qr', 'compliance'],
    topics: ['invoices.tax'],
    body: `KRA requires tax invoices to be registered through eTIMS. AuditOS is not connected to KRA yet.

## What happens now
When an invoice is issued it is handled in practice mode, which makes up a control number beginning SIM-. The invoice screen says **PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice.** The PDF is marked the same way. Nothing is sent to KRA.

## What this means for you
Use these invoices to run the practice and test the process. Do not give a client an invoice from AuditOS as your tax invoice until the connection exists, or register the invoice with KRA separately.

## What is needed to connect
KRA eTIMS credentials for the firm's registered taxpayer PIN. Once they are configured the invoices will carry a real control number and QR code, and the warning disappears.

## If a submission fails
The invoice stays issued and shows the problem; use **Submit again**.`,
  },
];
