import sharp from 'sharp';
import { checkLogo } from './logo';

/** The icon sizes handed out. `padding` is the share of the side left blank on each edge. */
export const ICON_VARIANTS = {
  '32': { size: 32, padding: 0.08 },
  '180': { size: 180, padding: 0.12 },
  '192': { size: 192, padding: 0.12 },
  '512': { size: 512, padding: 0.12 },
  maskable: { size: 512, padding: 0.22 },
} as const satisfies Record<string, { size: number; padding: number }>;

export type IconVariant = keyof typeof ICON_VARIANTS;

export const isIconVariant = (v: string): v is IconVariant => Object.hasOwn(ICON_VARIANTS, v);

// Bounds on what the picture library may do: nothing here keeps pictures in its own memory, and a slow or huge one is dropped.
sharp.cache(false);
sharp.concurrency(2);
const MAX_INPUT_PIXELS = 2000 * 2000;
const MAX_SECONDS = 5;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * A square PNG of the logo, centred on white with blank edges, never stretched. Returns null when the file
 * fails the same checks as the upload (so a damaged or tampered row is never opened) or cannot be drawn.
 */
export async function squareIcon(bytes: Buffer, variant: IconVariant): Promise<Buffer | null> {
  if (!checkLogo(bytes).ok) return null;
  const { size, padding } = ICON_VARIANTS[variant];
  const edge = Math.round(size * padding);
  const inner = size - 2 * edge;
  try {
    return await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true, pages: 1 })
      .timeout({ seconds: MAX_SECONDS })
      .rotate()
      .resize({ width: inner, height: inner, fit: 'contain', background: WHITE })
      .flatten({ background: WHITE })
      .extend({ top: edge, bottom: edge, left: edge, right: edge, background: WHITE })
      .toColourspace('srgb')
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Finished icons, by logo and variant. A logo never changes once stored, so an entry never goes stale. */
const MAX_KEPT = 200;
const kept = new Map<string, Buffer | null>();

export const keptIcon = (key: string): Buffer | null | undefined => kept.get(key);
export function keepIcon(key: string, icon: Buffer | null): void {
  if (kept.size >= MAX_KEPT && !kept.has(key)) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  kept.set(key, icon);
}
