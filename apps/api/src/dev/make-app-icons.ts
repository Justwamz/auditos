// Renders the AuditOS app icons (PNG) from the SVG mark. Run:
//   pnpm --filter @auditos/api exec tsx src/dev/make-app-icons.ts
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../../web/public/icons');
mkdirSync(out, { recursive: true });
const svg = readFileSync(join(out, 'auditos.svg'));

for (const size of [32, 180, 192, 512]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(join(out, `auditos-${size}.png`));
}

// Maskable: the mark sits inside the central 60% on a full-bleed green square.
const inner = Math.round(512 * 0.6);
const mark = await sharp(svg, { density: 384 })
  .resize(inner, inner)
  .png()
  .toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2e6b4c' } })
  .composite([{ input: mark, gravity: 'centre' }])
  .png()
  .toFile(join(out, 'auditos-maskable.png'));
console.log('icons written');
