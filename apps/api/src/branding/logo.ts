import { pngDecodes } from '@auditos/exports';
export const MAX_LOGO_BYTES = 1024 * 1024;
export const MAX_LOGO_SIDE = 2000;

export const LOGO_NOT_PICTURE = 'That file is not a PNG or JPG picture.';
export const LOGO_TOO_BIG = 'Logos can be at most 1 MB.';
export const LOGO_TOO_WIDE = 'Logos can be at most 2000 pixels wide or tall.';
export const LOGO_ANIMATED = 'Animated pictures cannot be used as a logo. Please use a still PNG or JPG.';

export type LogoCheck =
  | { ok: true; contentType: 'image/png' | 'image/jpeg'; width: number; height: number }
  | { ok: false; reason: string };

const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');

function readPng(b: Buffer): { width: number; height: number; animated: boolean } | null {
  if (b.length < 33 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  // Walk the chunks up to the first image data: an animation control chunk means an animated picture.
  let animated = false;
  for (let o = 8; o + 8 <= b.length; ) {
    const len = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    if (type === 'acTL') animated = true;
    if (type === 'IDAT' || type === 'IEND') break;
    o += 12 + len;
  }
  return { width, height, animated };
}

function readJpeg(b: Buffer): { width: number; height: number } | null {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = b.readUInt16BE(o + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (o + 9 > b.length) return null;
      return { height: b.readUInt16BE(o + 5), width: b.readUInt16BE(o + 7) };
    }
    if (len < 2) return null;
    o += 2 + len;
  }
  return null;
}

/** Decides what a file really is from its bytes (never its name or the type the browser claims). */
export function checkLogo(data: Buffer): LogoCheck {
  const isPng = data.length >= 8 && data.subarray(0, 8).equals(PNG_SIG);
  const isJpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!isPng && !isJpeg) return { ok: false, reason: LOGO_NOT_PICTURE };
  if (data.length > MAX_LOGO_BYTES) return { ok: false, reason: LOGO_TOO_BIG };
  let size: { width: number; height: number } | null;
  if (isPng) {
    const png = readPng(data);
    if (png?.animated) return { ok: false, reason: LOGO_ANIMATED };
    size = png;
  } else {
    size = readJpeg(data);
  }
  if (!size || size.width < 1 || size.height < 1) return { ok: false, reason: LOGO_NOT_PICTURE };
  if (size.width > MAX_LOGO_SIDE || size.height > MAX_LOGO_SIDE) return { ok: false, reason: LOGO_TOO_WIDE };
  // A picture whose data cannot be decoded would break the PDF, so it is refused here.
  if (isPng && !pngDecodes(data)) return { ok: false, reason: LOGO_NOT_PICTURE };
  return { ok: true, contentType: isPng ? 'image/png' : 'image/jpeg', width: size.width, height: size.height };
}
