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

/** Draws the icon; throws when the picture library cannot (damaged data, too large, too slow). */
async function draw(bytes: Buffer, variant: IconVariant): Promise<Buffer> {
  const { size, padding } = ICON_VARIANTS[variant];
  const edge = Math.round(size * padding);
  const inner = size - 2 * edge;
  return sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true, pages: 1 })
    .timeout({ seconds: MAX_SECONDS })
    .rotate()
    .resize({ width: inner, height: inner, fit: 'contain', background: WHITE })
    .flatten({ background: WHITE })
    .extend({ top: edge, bottom: edge, left: edge, right: edge, background: WHITE })
    .toColourspace('srgb')
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A square PNG of the logo, centred on white with blank edges, never stretched. Returns null when the file
 * fails the same checks as the upload (so a damaged or tampered row is never opened) or cannot be drawn.
 */
export async function squareIcon(bytes: Buffer, variant: IconVariant): Promise<Buffer | null> {
  if (!checkLogo(bytes).ok) return null;
  try {
    return await draw(bytes, variant);
  } catch {
    return null;
  }
}

/** Tests may swap the drawing step (to make it fail once, count calls or be slow). */
let drawer: (bytes: Buffer, variant: IconVariant) => Promise<Buffer> = draw;
export const setDrawer = (fn: ((bytes: Buffer, variant: IconVariant) => Promise<Buffer>) | null): void => {
  drawer = fn ?? draw;
};

/** Finished icons, by logo and variant, held within an entry limit and a total size limit. A logo never changes once stored. */
export const MAX_KEPT = 200;
export const MAX_KEPT_BYTES = 24 * 1024 * 1024;
const kept = new Map<string, Buffer | null>();
let keptBytes = 0;

export const keptIcon = (key: string): Buffer | null | undefined => kept.get(key);
export const keptSize = (): { entries: number; bytes: number } => ({ entries: kept.size, bytes: keptBytes });
export const clearKept = (): void => {
  kept.clear();
  keptBytes = 0;
};
export function keepIcon(key: string, icon: Buffer | null): void {
  const old = kept.get(key);
  if (kept.has(key)) {
    keptBytes -= old?.length ?? 0;
    kept.delete(key);
  }
  const add = icon?.length ?? 0;
  while (kept.size > 0 && (kept.size >= MAX_KEPT || keptBytes + add > MAX_KEPT_BYTES)) {
    const oldest = kept.keys().next().value as string;
    keptBytes -= kept.get(oldest)?.length ?? 0;
    kept.delete(oldest);
  }
  kept.set(key, icon);
  keptBytes += add;
}

// At most this many drawings run at once; the rest wait their turn.
const MAX_AT_ONCE = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function turn<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const inProgress = new Map<string, Promise<Buffer | null>>();

/**
 * The icon for a stored logo, drawn once however many ask at the same time. A file that fails the upload checks is
 * remembered as unusable (that never changes); a drawing failure is not remembered, so the next request tries again.
 */
export function produceIcon(key: string, bytes: Buffer, variant: IconVariant): Promise<Buffer | null> {
  const hit = kept.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = inProgress.get(key);
  if (running) return running;
  const job = (async (): Promise<Buffer | null> => {
    if (!checkLogo(bytes).ok) {
      keepIcon(key, null);
      return null;
    }
    try {
      const icon = await turn(() => drawer(bytes, variant));
      keepIcon(key, icon);
      return icon;
    } catch {
      return null;
    }
  })().finally(() => inProgress.delete(key));
  inProgress.set(key, job);
  return job;
}
