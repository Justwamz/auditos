import { inflateSync } from 'node:zlib';

/** The largest side a logo may have; shared with the upload check. */
export const MAX_LOGO_SIDE = 2000;
const SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

/**
 * True only when the picture's image data really decodes: the data inflates, has exactly the size the header promises and
 * every scanline starts with a valid filter byte. PDF software throws from inside a background callback on damaged data,
 * which no try/catch can stop, so a damaged picture must be found out before it is handed over.
 */
export function pngDecodes(b: Buffer): boolean {
  try {
    if (b.length < 33 || !b.subarray(0, 8).equals(SIG) || b.toString('latin1', 12, 16) !== 'IHDR') return false;
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const depth = b[24]!;
    const channels = CHANNELS[b[25]!];
    const interlaced = b[28] === 1;
    if (!channels || w < 1 || h < 1 || w > MAX_LOGO_SIDE || h > MAX_LOGO_SIDE || ![1, 2, 4, 8, 16].includes(depth)) return false;
    const idat: Buffer[] = [];
    for (let o = 8; o + 12 <= b.length; ) {
      const len = b.readUInt32BE(o);
      const type = b.toString('latin1', o + 4, o + 8);
      if (o + 12 + len > b.length) return false;
      if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
      if (type === 'IEND') break;
      o += 12 + len;
    }
    if (idat.length === 0) return false;
    const bpp = channels * depth;
    const rows: number[] = []; // bytes per scanline, in order
    if (!interlaced) for (let y = 0; y < h; y++) rows.push(Math.ceil((w * bpp) / 8));
    else {
      for (const [x0, y0, dx, dy] of ADAM7) {
        const pw = Math.ceil((w - x0) / dx);
        const ph = Math.ceil((h - y0) / dy);
        if (pw > 0 && ph > 0) for (let y = 0; y < ph; y++) rows.push(Math.ceil((pw * bpp) / 8));
      }
    }
    // The size is known from the header, so a stream that inflates to more is refused without being unpacked.
    const expected = rows.reduce((t, n) => t + 1 + n, 0);
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
    let o = 0;
    for (const n of rows) {
      if (o >= raw.length || raw[o]! > 4) return false;
      o += 1 + n;
    }
    return o === raw.length;
  } catch {
    return false;
  }
}

/**
 * The size of a logo that is safe to hand to PDF or Word software, or null when it is not. A PNG must really decode; a JPEG
 * must start with the right signature and carry a readable size. Anything else is treated as "no logo".
 */
export function logoSize(logo: { bytes: Buffer; type: 'image/png' | 'image/jpeg' }): { width: number; height: number } | null {
  try {
    const b = logo.bytes;
    if (logo.type === 'image/png') {
      if (!pngDecodes(b)) return null;
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let o = 2; o + 9 < b.length; ) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1]!;
      if (marker === 0xff) { o += 1; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue; }
      const len = b.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = b.readUInt16BE(o + 5);
        const width = b.readUInt16BE(o + 7);
        return width > 0 && height > 0 && width <= MAX_LOGO_SIDE && height <= MAX_LOGO_SIDE ? { width, height } : null;
      }
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}
