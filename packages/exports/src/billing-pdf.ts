import PDFDocument from 'pdfkit';
import { pngDecodes } from './png-check';

export interface PdfLetterhead {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  kraPin: string | null;
  bankDetails: string | null;
  footerNote: string | null;
  /** A six-digit colour code such as #1f5f4a. */
  primary: string;
  logo: { bytes: Buffer; type: 'image/png' | 'image/jpeg' } | null;
}

export interface BillingPdf {
  kind: 'invoice' | 'quote';
  /** Null while the document is still a draft. */
  number: string | null;
  status: string;
  /** The firm's letterhead as it was when the document was issued (or as it stands now, for a draft). */
  letterhead: PdfLetterhead;
  clientName: string;
  /** Issue date for an invoice, or the date the quote was sent. */
  date: string | null;
  /** Due date for an invoice, or "valid until" for a quote. */
  dueOrValidUntil: string | null;
  lines: { description: string; quantity: string; unit: string; amount: string }[];
  subtotal: string;
  taxMode: 'exclusive' | 'inclusive';
  taxes: { name: string; rate: string; amount: string }[];
  total: string;
  paid?: string;
  outstanding?: string;
  notes: string | null;
  /** Set when the invoice went through the simulated tax-submission provider. */
  simulatedTax?: { controlNumber: string | null; message: string } | null;
}

/** Printed whenever the tax submission was practice only, whatever wording an older invoice saved. */
const PRACTICE_SENTENCE = 'PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice.';
const LEFT = 56;
const RIGHT = 556;
const FALLBACK_PRIMARY = '#1f3a5f';
const POWERED_BY = 'Powered by AuditOS';
const LOGO_MAX_W = 160;
const LOGO_MAX_H = 60;

/** Plain text for the page: control characters become spaces and a blank value becomes nothing. */
const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim();
  return t === '' ? null : t;
};

/** A one-page (or more) invoice or quote. A draft, a void document and a simulated tax submission are each marked so nobody mistakes them for the real thing. */
export async function exportBillingPdf(d: BillingPdf): Promise<Buffer> {
  try {
    return await render(d, d.letterhead.logo);
  } catch (e) {
    // A logo that cannot be read must never stop the document: draw it again with the name only.
    if (!d.letterhead.logo) throw e;
    return render(d, null);
  }
}

function render(d: BillingPdf, logoIn: PdfLetterhead['logo']): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lh = d.letterhead;
    let logo = logoIn;
    const primary = /^#[0-9a-fA-F]{6}$/.test(lh.primary) ? lh.primary : FALLBACK_PRIMARY;
    const label = d.kind === 'invoice' ? 'INVOICE' : 'QUOTATION';
    const title = d.number ? `${label} ${d.number}` : `DRAFT ${label}`;
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 96, left: LEFT, right: 612 - RIGHT }, compress: false, info: { Title: title, Author: clean(lh.name) ?? 'AuditOS' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // The footer note is wrapped by hand into at most three lines, so a long note can never push into the page body.
    const note = clean(lh.footerNote);
    const noteLines: string[] = [];
    const fits3 = (t: string) => doc.font('Helvetica').fontSize(8).widthOfString(t) <= RIGHT - LEFT;
    if (note) {
      doc.font('Helvetica').fontSize(8);
      const fits = (t: string) => doc.widthOfString(t) <= RIGHT - LEFT;
      let cur = '';
      for (let w of note.split(/\s+/)) {
        // A word wider than the page (a long web address) is cut by width into pieces.
        while (!fits(w)) {
          let n = w.length - 1;
          while (n > 1 && !fits(w.slice(0, n))) n--;
          if (cur) { noteLines.push(cur); cur = ''; }
          noteLines.push(w.slice(0, n));
          w = w.slice(n);
        }
        const next = cur ? `${cur} ${w}` : w;
        if (cur && !fits(next)) {
          noteLines.push(cur);
          cur = w;
        } else cur = next;
      }
      if (cur) noteLines.push(cur);
    }
    const shownNote = noteLines.slice(0, 3);
    if (noteLines.length > 3) {
      let last = shownNote[2]!;
      while (last.length > 1 && !fits3(`${last}...`)) last = last.slice(0, -1);
      shownNote[2] = `${last}...`;
    }

    const watermark = d.status === 'draft' ? 'DRAFT' : d.status === 'void' ? 'VOID' : null;
    const decorate = () => {
      const y = doc.y;
      if (watermark) {
        doc.save();
        doc.rotate(-35, { origin: [300, 420] }).fontSize(110).fillColor('#e8b4b4').opacity(0.35).text(watermark, 90, 360, { lineBreak: false });
        doc.restore();
      }
      doc.font('Helvetica').fontSize(8).fillColor('#333333').opacity(1);
      shownNote.forEach((l, i) => doc.text(l, LEFT, 752 + i * 10, { lineBreak: false }));
      if (d.simulatedTax) {
        doc.fontSize(8).fillColor('#b00020').opacity(1).text('PRACTICE ONLY: not sent to KRA. Not a valid tax invoice.', LEFT, 790, { lineBreak: false });
      }
      doc.fontSize(8).fillColor('#666666').opacity(1).text(d.number ? `${label} ${d.number}` : `Draft ${label.toLowerCase()}`, LEFT, 804, { lineBreak: false });
      // No width here: text with a width is wrapped, and this line sits below the bottom margin on purpose.
      doc.fontSize(8).fillColor('#666666').text(POWERED_BY, RIGHT - doc.widthOfString(POWERED_BY), 804, { lineBreak: false });
      doc.fillColor('#000000');
      doc.y = y;
    };
    decorate();
    doc.on('pageAdded', decorate);

    // Letterhead: the logo (kept inside a box), then the name, which stands alone in the firm colour when there is no logo.
    let top = 56;
    if (logo && !pngDecodes(logo.bytes) && logo.type === 'image/png') logo = null;
    if (logo) {
      try {
        const img = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } & object }).openImage(logo.bytes);
        if (!(img.width > 0 && img.height > 0 && Number.isFinite(img.width) && Number.isFinite(img.height))) throw new Error('unreadable logo');
        const scale = Math.min(LOGO_MAX_W / img.width, LOGO_MAX_H / img.height, 1);
        doc.image(img as unknown as Buffer, LEFT, top, { width: img.width * scale, height: img.height * scale });
        top += img.height * scale + 6;
      } catch {
        logo = null;
      }
    }
    doc.font('Helvetica-Bold').fontSize(logo ? 12 : 15).fillColor(logo ? '#000000' : primary).text(clean(lh.name) ?? 'Audit firm', LEFT, top, { width: RIGHT - LEFT });
    doc.fillColor('#000000').font('Helvetica').fontSize(9);
    const address = clean(lh.address);
    if (address) doc.text(address, LEFT, undefined, { width: RIGHT - LEFT });
    for (const [lab, v] of [['Tel', lh.phone], ['Email', lh.email], ['Web', lh.website], ['KRA PIN', lh.kraPin]] as const) {
      const t = clean(v);
      if (t) doc.text(`${lab}: ${t}`, LEFT, undefined, { width: RIGHT - LEFT });
    }
    doc.moveDown(0.4);
    const ruleY = doc.y;
    doc.save().moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).lineWidth(1.5).strokeColor(primary).stroke().restore();
    doc.fillColor('#000000');
    doc.y = ruleY + 12;
    doc.font('Helvetica-Bold').fontSize(16).text(title, LEFT);
    doc.font('Helvetica').fontSize(10).moveDown(0.4);
    doc.text(`To: ${d.clientName}`);
    if (d.date) doc.text(`${d.kind === 'invoice' ? 'Date' : 'Sent'}: ${d.date}`);
    if (d.dueOrValidUntil) doc.text(`${d.kind === 'invoice' ? 'Due' : 'Valid until'}: ${d.dueOrValidUntil}`);
    doc.text('Currency: KES');
    if (d.simulatedTax?.controlNumber) doc.text(`Control number: ${d.simulatedTax.controlNumber} (practice)`);
    doc.moveDown();

    const cols = { desc: LEFT, qty: 330, unit: 400, amt: 480 };
    const row = (cells: [string, string, string, string], bold: boolean) => {
      if (doc.y > 730) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      doc.text(cells[0], cols.desc, y, { width: 260, lineBreak: false });
      doc.text(cells[1], cols.qty, y, { width: 60, align: 'right', lineBreak: false });
      doc.text(cells[2], cols.unit, y, { width: 70, align: 'right', lineBreak: false });
      doc.text(cells[3], cols.amt, y, { width: RIGHT - cols.amt, align: 'right', lineBreak: false });
      doc.y = y + 14;
    };
    row(['Description', 'Qty', 'Unit price', 'Amount'], true);
    for (const l of d.lines) row([l.description.slice(0, 70), l.quantity, l.unit, l.amount], false);
    doc.moveDown(0.5);

    // The grand totals are bold and in the firm colour, so they still stand out when printed in black and white.
    const total = (name: string, amount: string, bold = false) => {
      if (doc.y > 730) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? primary : '#000000');
      doc.text(name, 330, y, { width: 140, lineBreak: false });
      doc.text(amount, cols.amt, y, { width: RIGHT - cols.amt, align: 'right', lineBreak: false });
      doc.fillColor('#000000');
      doc.y = y + 15;
    };
    total(d.taxes.length > 0 && d.taxMode === 'inclusive' ? 'Amount before tax' : 'Subtotal', d.subtotal);
    for (const t of d.taxes) total(`${t.name} ${t.rate}%${d.taxMode === 'inclusive' ? ' (included)' : ''}`, t.amount);
    if (d.taxes.length === 0) total('Tax', 'None charged');
    total('Total (KES)', d.total, true);
    if (d.paid !== undefined) total('Paid', d.paid);
    if (d.outstanding !== undefined) total('Balance due', d.outstanding, true);

    if (d.notes) doc.moveDown().font('Helvetica').fontSize(9).text(d.notes, LEFT, undefined, { width: RIGHT - LEFT });
    const bank = clean(lh.bankDetails);
    if (bank) doc.moveDown().font('Helvetica-Bold').fontSize(9).text('Payment details', LEFT, undefined, { width: RIGHT - LEFT }).font('Helvetica').text(bank, { width: RIGHT - LEFT });
    if (d.simulatedTax) doc.moveDown().font('Helvetica-Oblique').fontSize(9).fillColor('#b00020').text(PRACTICE_SENTENCE, LEFT, undefined, { width: RIGHT - LEFT }).fillColor('#000000');
    doc.end();
  });
}
