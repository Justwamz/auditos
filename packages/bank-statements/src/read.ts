import { csvLines, xlsxLines } from './grid';
import { pdfLines } from './pdf';
import { parseTable } from './table';
import { StatementError, type ParsedStatement, type ReadInput } from './types';

/** Reads a statement from a text PDF, a CSV or an Excel workbook. Anything it cannot read is refused with a reason. */
export async function readStatement(input: ReadInput): Promise<ParsedStatement> {
  if (input.kind === 'pdf') return parseTable(await pdfLines(input.data, input.password), 'pdf');
  if (input.kind === 'csv') return parseTable(csvLines(input.text), 'csv');
  if (input.kind === 'xlsx') return parseTable(await xlsxLines(input.data), 'xlsx');
  throw new StatementError('unreadable_file', 'Unsupported file type.');
}
