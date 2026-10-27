import PDFDocument from 'pdfkit';

/**
 * Synthetic statements in the layouts Kenyan banks commonly print. Every name, number and amount is made up.
 * The reader is tested against these; real statements will differ, which is why the screen asks for samples.
 */
export interface Row {
  date: string;
  desc: string;
  /** Second printed line of a long description. */
  desc2?: string;
  out?: string;
  in?: string;
  bal?: string;
}

export const OPENING = '100,000.00';
export const ROWS: Row[] = [
  { date: '02/03/2026', desc: 'ATM WITHDRAWAL WESTLANDS', out: '5,000.00', bal: '95,000.00' },
  { date: '03/03/2026', desc: 'SALARY MARCH', desc2: 'ACME TRADERS LTD', in: '150,000.00', bal: '245,000.00' },
  { date: '05/03/2026', desc: 'CHEQUE 000123 JANE WANJIKU', out: '20,000.00', bal: '225,000.00' },
  { date: '10/03/2026', desc: 'MPESA PAYBILL 247247 KPLC', out: '3,450.50', bal: '221,549.50' },
  { date: '15/03/2026', desc: 'TRANSFER FROM MWANGAZA TRADERS', in: '500,000.00', bal: '721,549.50' },
  { date: '15/03/2026', desc: 'TRANSFER FROM MWANGAZA TRADERS', in: '500,000.00', bal: '1,221,549.50' },
  { date: '21/03/2026', desc: 'CASH DEPOSIT', in: '75,000.00', bal: '1,296,549.50' },
  { date: '28/03/2026', desc: 'CHEQUE 000124 RETURNED UNPAID', out: '20,000.00', bal: '1,276,549.50' },
  { date: '30/03/2026', desc: 'SUPPLIER PAYMENT KIPROP HARDWARE', out: '1,100,000.00', bal: '176,549.50' },
  { date: '31/03/2026', desc: 'BANK CHARGES', out: '1,200.00', bal: '175,349.50' },
];
export const CLOSING = '175,349.50';

function make(options: PDFKit.PDFDocumentOptions, draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, ...options });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

const put = (doc: PDFKit.PDFDocument, text: string, x: number, y: number, right = false, width = 90) =>
  doc.text(text, right ? x : x, y, { lineBreak: false, ...(right ? { width, align: 'right' as const } : {}) });

export interface BankPdfOptions {
  password?: string;
  rows?: Row[];
  rowsPerPage?: number;
  /** Leave the closing balance line out. */
  noClosing?: boolean;
  /** Print money out and money in as one signed column. */
  signedColumn?: boolean;
  /** Headings used by another bank. */
  headings?: { date: string; desc: string; out: string; in: string; bal: string };
  bankName?: string;
}

/** A typical bank statement: Date, Description, Debit, Credit, Balance, with opening and closing balance lines and a repeated header on each page. */
export function bankPdf(o: BankPdfOptions = {}): Promise<Buffer> {
  const rows = o.rows ?? ROWS;
  const per = o.rowsPerPage ?? 40;
  const h = o.headings ?? { date: 'Date', desc: 'Description', out: 'Debit', in: 'Credit', bal: 'Balance' };
  const opts: PDFKit.PDFDocumentOptions = o.password ? { userPassword: o.password, ownerPassword: `${o.password}-owner`, pdfVersion: '1.7ext3' } : {};
  return make(opts, (doc) => {
    let y = 0;
    let page = 0;
    const header = () => {
      page += 1;
      doc.fontSize(11).font('Helvetica-Bold');
      put(doc, `${o.bankName ?? 'EXAMPLE BANK LIMITED'} - Account Statement`, 40, 40);
      doc.fontSize(9).font('Helvetica');
      put(doc, 'Account Name: MWANGAZA TRADERS LTD', 40, 60);
      put(doc, 'Account No: 0123456789', 40, 72);
      put(doc, 'Statement period: 01 Mar 2026 to 31 Mar 2026', 40, 84);
      doc.font('Helvetica-Bold');
      y = 110;
      put(doc, h.date, 40, y);
      put(doc, h.desc, 110, y);
      if (o.signedColumn) put(doc, 'Amount', 360, y);
      else {
        put(doc, h.out, 330, y);
        put(doc, h.in, 400, y);
      }
      put(doc, h.bal, 480, y);
      doc.font('Helvetica');
      y += 18;
    };
    header();
    const line = (r: Row & { label?: string }) => {
      if (y > 760) {
        put(doc, `Page ${page}`, 40, 800);
        doc.addPage();
        header();
      }
      put(doc, r.date, 40, y);
      put(doc, r.desc, 110, y);
      if (o.signedColumn) {
        const v = r.out ? `-${r.out}` : r.in ? r.in : '';
        if (v) put(doc, v, 330, y, true, 110);
      } else {
        if (r.out) put(doc, r.out, 300, y, true, 80);
        if (r.in) put(doc, r.in, 370, y, true, 80);
      }
      if (r.bal) put(doc, r.bal, 440, y, true, 110);
      y += 12;
      if (r.desc2) {
        put(doc, r.desc2, 110, y);
        y += 12;
      }
    };
    line({ date: '', desc: 'Balance brought forward', bal: OPENING });
    rows.forEach((r, i) => {
      if (i > 0 && i % per === 0) y = 9999;
      line(r);
    });
    if (!o.noClosing) line({ date: '', desc: 'Closing balance', bal: o.rows ? o.rows.at(-1)?.bal ?? CLOSING : CLOSING });
  });
}

/** An M-Pesa style statement: Receipt No, Completion Time, Details, Status, Paid in, Withdrawn, Balance. */
export function mpesaPdf(): Promise<Buffer> {
  const data = [
    ['QCE1A2B3C4', '2026-03-02 09:14:22', 'Customer Transfer to - 0712345678 JOHN KAMAU', 'Completed', '', '1,500.00', '8,500.00'],
    ['QCE1A2B3C5', '2026-03-03 11:02:10', 'Pay Bill to 247247 - KPLC PREPAID', 'Completed', '', '2,000.00', '6,500.00'],
    ['QCE1A2B3C6', '2026-03-05 16:45:01', 'Funds received from - 0722111222 PETER NJOROGE', 'Completed', '12,000.00', '', '18,500.00'],
    ['QCE1A2B3C7', '2026-03-09 08:30:45', 'Customer Withdrawal At Agent - 123456 MAMA MBOGA', 'Completed', '', '3,000.00', '15,500.00'],
  ];
  return make({}, (doc) => {
    doc.fontSize(11).font('Helvetica-Bold');
    put(doc, 'MPESA FULL STATEMENT', 40, 40);
    doc.fontSize(8).font('Helvetica');
    put(doc, 'Customer Name: MAMA MBOGA GROCERIES', 40, 58);
    put(doc, 'Statement Period: 01 Mar 2026 - 31 Mar 2026', 40, 70);
    doc.font('Helvetica-Bold').fontSize(7);
    const heads: [string, number][] = [['Receipt No', 40], ['Completion Time', 100], ['Details', 185], ['Transaction Status', 335], ['Paid in', 420], ['Withdrawn', 470], ['Balance', 525]];
    for (const [t, x] of heads) put(doc, t, x, 100);
    doc.font('Helvetica').fontSize(7);
    let y = 118;
    for (const r of data) {
      put(doc, r[0]!, 40, y);
      put(doc, r[1]!, 100, y);
      put(doc, r[2]!.slice(0, 40), 185, y);
      put(doc, r[3]!, 335, y);
      if (r[4]) put(doc, r[4], 395, y, true, 50);
      if (r[5]) put(doc, r[5], 445, y, true, 55);
      put(doc, r[6]!, 495, y, true, 60);
      y += 14;
    }
  });
}

/** A page with only a picture-like shape and no text, as a scanned statement would be. */
export function imageOnlyPdf(): Promise<Buffer> {
  return make({}, (doc) => {
    doc.rect(50, 50, 400, 600).fill('#dddddd');
  });
}

/** Not a PDF at all, with a .pdf name. */
export const notAPdf = (): Uint8Array => new TextEncoder().encode('This is just text pretending to be a PDF.');

export const csvOf = (rows: Row[] = ROWS, head = 'Date,Description,Debit,Credit,Balance'): string =>
  [head, `,Balance brought forward,,,"${OPENING}"`, ...rows.map((r) => `${r.date},"${r.desc}${r.desc2 ? ' ' + r.desc2 : ''}","${r.out ?? ''}","${r.in ?? ''}","${r.bal ?? ''}"`), `,Closing balance,,,"${CLOSING}"`].join('\n');
