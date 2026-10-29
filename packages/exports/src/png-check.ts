import { inflateSync } from 'node:zlib';

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
    if (!channels || w < 1 || h < 1 || w > 20000 || h > 20000 || ![1, 2, 4, 8, 16].includes(depth)) return false;
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
    const raw = inflateSync(Buffer.concat(idat));
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
