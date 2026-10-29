import type { Article } from '../src/types';

export const branding: Article[] = [
  {
    id: 'firm-logo-and-colours',
    title: "Set your firm's logo and colours",
    summary: 'Adding your logo, contact details and two colours, and what the firm administrator sees before saving.',
    category: 'Administration',
    audience: ['admin', 'firm_admin'],
    tags: ['branding', 'logo', 'colours', 'colors', 'brand', 'letterhead', 'footer note', 'phone', 'website', 'reset', 'invoice look'],
    topics: ['branding'],
    body: `Open **People**, then the **Branding** tab. Only the firm administrator sees it. Everyone else in the firm sees the result: the menu, buttons and links take your colours, and your logo shows in the menu and at the top of quotations and invoices. "Powered by AuditOS" always stays under your firm name.

## Logo
Choose a PNG or JPG picture up to 1 MB, no more than 2000 pixels wide or tall, then press **Upload logo**. It is saved straight away. **Replace logo** puts a new one in its place and **Remove logo** takes it out of use. Invoices and quotations that were already issued keep the logo they were issued with.

## Contact details
Phone, email, website and a short footer note print under your firm name. Leave a box empty to leave it out. A website starts with http:// or https://. The firm name, address, KRA PIN and bank details are shown here but are changed by a partner in **Billing**, **Settings**, **Invoice details**.

## Colours
Each colour has a picker and a colour code box, for example #2e6b4c. They stay in step: change one and the other follows. The **Preview** shows the menu, a button, a table row and the top of an invoice in your colours as you pick.

If a colour would make text hard to read, for example a very pale yellow, we darken it a little and say so, with the colour before and after. What we darkened is what gets saved.

## Save, or start again
Press **Save branding** to keep your colours and contact details. **Reset to AuditOS colours** puts the two colours back to the standard green and saves that. Warning colours such as overdue, and the colours used in the calendar, never change.

## Exported statements
Word, Excel and PDF statements show your letterhead too: logo and firm name at the top (in Excel, one line of text with the firm name and contact details), your footer note and "Powered by AuditOS" at the bottom. They always use your branding as it is now, so a change shows on the next export.

## Already issued documents
An invoice or quotation takes your letterhead at the moment it is issued or sent. Changing your logo, colours or details later does not change documents that are already out; it applies to new ones.`,
  },
];
