import { createHash } from 'node:crypto';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type Kind = 'pdf' | 'png' | 'jpg' | 'zip' | 'text';
const TYPES: Record<string, { kind: Kind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  png: { kind: 'png', mime: 'image/png' },
  jpg: { kind: 'jpg', mime: 'image/jpeg' },
  jpeg: { kind: 'jpg', mime: 'image/jpeg' },
  xlsx: { kind: 'zip', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  docx: { kind: 'zip', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  csv: { kind: 'text', mime: 'text/csv' },
  txt: { kind: 'text', mime: 'text/plain' },
};

const startsWith = (data: Buffer, bytes: number[]) => bytes.every((b, i) => data[i] === b);

const MAGIC: Record<Exclude<Kind, 'text'>, (d: Buffer) => boolean> = {
  pdf: (d) => startsWith(d, [0x25, 0x50, 0x44, 0x46]),
  png: (d) => startsWith(d, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (d) => startsWith(d, [0xff, 0xd8, 0xff]),
  zip: (d) => startsWith(d, [0x50, 0x4b, 0x03, 0x04]),
};

function isPlainText(data: Buffer): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

/** Strips directories and anything outside [A-Za-z0-9._-]; keeps a lower-cased extension. */
export function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 100);
  const dot = cleaned.lastIndexOf('.');
  return dot > 0 ? `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).toLowerCase()}` : cleaned;
}

export type UploadCheck =
  | { ok: true; safeName: string; mime: string; sha256: string; size: number }
  | { ok: false; reason: string };

export function validateUpload(name: string, data: Buffer): UploadCheck {
  if (data.length === 0) return { ok: false, reason: 'File is empty' };
  if (data.length > MAX_UPLOAD_BYTES) return { ok: false, reason: 'File is too large (25 MB maximum)' };
  const safeName = sanitizeName(name);
  const dot = safeName.lastIndexOf('.');
  const ext = dot > 0 ? safeName.slice(dot + 1) : '';
  const type = TYPES[ext];
  if (!type) return { ok: false, reason: `File type .${ext || '(none)'} is not allowed` };
  const matches = type.kind === 'text' ? isPlainText(data) : MAGIC[type.kind](data);
  if (!matches) return { ok: false, reason: 'File content does not match its extension' };
  return { ok: true, safeName, mime: type.mime, sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
}
