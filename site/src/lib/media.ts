import manifest from '../data/media-manifest.json';

export type MediaEntry = {
  src: string;
  srcset: string;
  width: number | null;
  height: number | null;
  type: string;
};

const entries = manifest as unknown as Record<string, MediaEntry>;

/**
 * Look up a pre-optimised image by its `/media/...` key.
 * Returns null when the file was not part of the export (e.g. a stock photo
 * the owner adds later by hand).
 */
export function media(key: string | undefined | null): MediaEntry | null {
  if (!key) return null;
  return entries[key] ?? null;
}

/** Convenience: the ready-to-use src/srcset pair for an image key. */
export function mediaAttrs(key: string | undefined | null, fallback = '') {
  const entry = media(key);
  if (!entry) {
    return { src: fallback, srcset: '', width: null, height: null };
  }
  return {
    src: entry.src,
    srcset: entry.srcset,
    width: entry.width,
    height: entry.height,
  };
}

/**
 * Hero and gallery images that actually exist on disk, so components can
 * iterate over them without hard-coding broken paths.
 */
export const galleryImages = [
  '/media/wp-content-uploads-2025-09-6-png/6.webp',
  '/media/wp-content-uploads-2025-09-10-png/10.webp',
  '/media/wp-content-uploads-2025-09-11-png/11.webp',
  '/media/wp-content-uploads-2025-09-gemini-generated-image-brolubr0ilubroli-png/gemini-generated-image-brolubr0ilubroli.webp',
  '/media/wp-content-uploads-2025-05-2-4-png/2-4.webp',
  '/media/wp-content-uploads-2025-05-2-5-png/2-5.webp',
  '/media/wp-content-uploads-2025-05-3-2-png/3-2.webp',
  '/media/wp-content-uploads-2025-05-4-png/4.webp',
].filter((key) => Boolean(entries[key]));

/**
 * Floor plans — present in the WordPress media library but never surfaced.
 * The published file is a marketing poster; the drawing is cropped out of it
 * by scripts/optimize-media.mjs and lands on "/media/curated/denah-45-72.webp".
 */
export const floorPlans = [
  {
    key: '/media/curated/denah-45-72.webp',
    label: 'Denah Tipe 45 / 72',
  },
].filter((p) => Boolean(entries[p.key]));
