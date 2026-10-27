import { StatementError, type Cell, type Line } from './types';

interface Positioned {
  text: string;
  x: number;
  y: number;
  right: number;
  page: number;
}

/** Words closer together than this are one piece of text; further apart they are different columns. */
const SAME_CELL_GAP = 7;
const SAME_LINE_TOLERANCE = 3;

/** Reads a text PDF into lines of positioned cells. Image-only PDFs, wrong passwords and non-PDFs are refused with a reason. */
export async function pdfLines(data: Uint8Array, password?: string): Promise<Line[]> {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 1024));
  if (!head.includes('%PDF')) throw new StatementError('not_a_pdf', 'That file is not a PDF, whatever its name says.');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs takes ownership of the buffer it is given, so give it a copy.
  const task = pdfjs.getDocument({ data: new Uint8Array(data), password: password ?? undefined, useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'PasswordException') {
      throw err.code === 2
        ? new StatementError('password_incorrect', 'The password for this PDF is not correct.')
        : new StatementError('password_required', 'This PDF is password protected. Enter its password to read it. The password is used once and not kept.');
    }
    throw new StatementError('unreadable_file', 'This PDF could not be opened. It may be damaged.');
  }

  const items: Positioned[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!('str' in it) || it.str.trim() === '') continue;
      const x = it.transform[4] as number;
      items.push({ text: it.str, x, y: it.transform[5] as number, right: x + (it.width as number), page: p });
    }
  }
  await doc.destroy();
  if (items.length === 0) throw new StatementError('scanned_pdf', 'This PDF has no readable text. It looks like a scan or a photo. Ask the bank for the statement as a text PDF, CSV or Excel file.');

  // Group into lines: by page, then top to bottom.
  items.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: Positioned[][] = [];
  for (const it of items) {
    const last = rows.at(-1);
    if (last && last[0]!.page === it.page && Math.abs(last[0]!.y - it.y) <= SAME_LINE_TOLERANCE) last.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of row) {
      const prev = cells.at(-1);
      if (prev && it.x - prev.right <= SAME_CELL_GAP) {
        prev.text += `${it.x - prev.right > 0.8 ? ' ' : ''}${it.text}`;
        prev.right = it.right;
      } else {
        cells.push({ text: it.text, x: it.x, right: it.right });
      }
    }
    return cells;
  });
}
