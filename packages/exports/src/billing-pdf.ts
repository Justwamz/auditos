import PDFDocument from 'pdfkit';

export interface BillingPdf {
  kind: 'invoice' | 'quote';
  /** Null while the document is still a draft. */
  number: string | null;
  status: string;
  issuer: { legalName: string | null; address: string | null; kraPin: string | null; bankDetails: string | null };
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

const LEFT = 56;
const RIGHT = 556;

/** A one-page (or more) invoice or quote. A draft, a void document and a simulated tax submission are each marked so nobody mistakes them for the real thing. */
export function exportBillingPdf(d: BillingPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const label = d.kind === 'invoice' ? 'INVOICE' : 'QUOTATION';
    const title = d.number ? `${label} ${d.number}` : `DRAFT ${label}`;
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: LEFT, right: 612 - RIGHT }, compress: false, info: { Title: title, Author: d.issuer.legalName ?? 'AuditOS' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const watermark = d.status === 'draft' ? 'DRAFT' : d.status === 'void' ? 'VOID' : null;
    const decorate = () => {
      const y = doc.y;
      if (watermark) {
        doc.save();
        doc.rotate(-35, { origin: [300, 420] }).fontSize(110).fillColor('#e8b4b4').opacity(0.35).text(watermark, 90, 360, { lineBreak: false });
        doc.restore();
      }
      if (d.simulatedTax) {
        doc.fontSize(8).fillColor('#b00020').opacity(1).text('SIMULATION: not submitted to KRA. Not a valid tax invoice.', LEFT, 790, { lineBreak: false });
      }
      doc.fontSize(8).fillColor('#666666').opacity(1).text(d.number ? `${label} ${d.number}` : `Draft ${label.toLowerCase()}`, LEFT, 804, { lineBreak: false });
      doc.fillColor('#000000');
      doc.y = y;
    };
    decorate();
    doc.on('pageAdded', decorate);

    doc.font('Helvetica-Bold').fontSize(14).text(d.issuer.legalName ?? 'Audit firm', LEFT, 56, { width: RIGHT - LEFT });
    doc.font('Helvetica').fontSize(9);
    if (d.issuer.address) doc.text(d.issuer.address);
    if (d.issuer.kraPin) doc.text(`KRA PIN: ${d.issuer.kraPin}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(16).text(title);
    doc.font('Helvetica').fontSize(10).moveDown(0.4);
    doc.text(`To: ${d.clientName}`);
    if (d.date) doc.text(`${d.kind === 'invoice' ? 'Date' : 'Sent'}: ${d.date}`);
    if (d.dueOrValidUntil) doc.text(`${d.kind === 'invoice' ? 'Due' : 'Valid until'}: ${d.dueOrValidUntil}`);
    doc.text('Currency: KES');
    if (d.simulatedTax?.controlNumber) doc.text(`Control number: ${d.simulatedTax.controlNumber} (SIMULATION)`);
    doc.moveDown();

    const cols = { desc: LEFT, qty: 330, unit: 400, amt: 480 };
    const row = (cells: [string, string, string, string], bold: boolean) => {
      if (doc.y > 740) doc.addPage();
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

    const total = (name: string, amount: string, bold = false) => {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(name, 330, y, { width: 140, lineBreak: false });
      doc.text(amount, cols.amt, y, { width: RIGHT - cols.amt, align: 'right', lineBreak: false });
      doc.y = y + 15;
    };
    total(d.taxes.length > 0 && d.taxMode === 'inclusive' ? 'Amount before tax' : 'Subtotal', d.subtotal);
    for (const t of d.taxes) total(`${t.name} ${t.rate}%${d.taxMode === 'inclusive' ? ' (included)' : ''}`, t.amount);
    if (d.taxes.length === 0) total('Tax', 'None charged');
    total('Total (KES)', d.total, true);
    if (d.paid !== undefined) total('Paid', d.paid);
    if (d.outstanding !== undefined) total('Balance due', d.outstanding, true);

    if (d.notes) doc.moveDown().font('Helvetica').fontSize(9).text(d.notes, LEFT, undefined, { width: RIGHT - LEFT });
    if (d.kind === 'invoice' && d.issuer.bankDetails) doc.moveDown().font('Helvetica-Bold').fontSize(9).text('Payment details').font('Helvetica').text(d.issuer.bankDetails, { width: RIGHT - LEFT });
    if (d.simulatedTax) doc.moveDown().font('Helvetica-Oblique').fontSize(9).fillColor('#b00020').text(d.simulatedTax.message, { width: RIGHT - LEFT }).fillColor('#000000');
    doc.end();
  });
}
