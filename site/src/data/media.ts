/**
 * What every curated asset actually is — the code-facing side of PLAN.md F6.
 *
 * The rule is simple: a photograph of the project may be the hero of a page,
 * a render may be used but has to say so. The verdicts live in
 * src/data/media-kinds.json — one record, read both here (pages) and by
 * plugins/rehype-responsive-images.mjs (images inside blog article bodies,
 * which no page can reach). scripts/optimize-media.mjs explains how each
 * verdict was reached and why the library is so thin.
 *
 * The summary that changes what the site is allowed to show: the curated
 * set holds **five** real photographs — the access road, the aerial of the
 * land, and since Nov 2026 three owner-supplied photos of a finished unit
 * (foto-1..3). Everything else that looks like a building is a
 * visualisation and carries the "Ilustrasi" label; the hero and the about
 * picture may now run on real photographs instead.
 */

import record from '../data/media-kinds.json';

export type MediaKind = 'foto' | 'render' | 'poster' | 'denah';

const KINDS: MediaKind[] = ['foto', 'render', 'poster', 'denah'];

const groups = record as unknown as Record<MediaKind, Record<string, string>> & {
  _note: string[];
};

/** asset name → what it is */
const KIND: Record<string, MediaKind> = {};
/** asset name → a truthful description of the picture itself */
const CAPTION: Record<string, string> = {};

for (const kind of KINDS) {
  for (const [name, caption] of Object.entries(groups[kind])) {
    KIND[name] = kind;
    CAPTION[name] = caption;
  }
}

/*
  `/media/curated/design-45-1200.webp` → `design-45`.

  Only the *width* suffix is stripped, and only at three digits or more:
  names like `unit-4`, `hero-2`, `design-45` and `denah-45-72` end in real
  numbers of their own, and an earlier version of this function ate them —
  every photograph in the library then looked like an unknown asset and got
  labelled "Ilustrasi".
*/
export function mediaName(key: string): string {
  return key
    .replace(/^.*\/media\/(?:curated\/)?/, '')
    .replace(/-\d{3,4}\.webp$/, '')
    .replace(/\.webp$/, '');
}

export function mediaKind(key: string): MediaKind | undefined {
  return KIND[mediaName(key)];
}

/** A description of the picture, or undefined for an asset nobody has seen. */
export function mediaCaption(key: string): string | undefined {
  return CAPTION[mediaName(key)];
}

/**
 * True when the asset is a visualisation rather than a photograph, so the
 * page has to label it. Posters never appear on a page at all, and a floor
 * plan is a drawing rather than a promise of a building — but an *unknown*
 * asset is treated as a render: an unlabelled render is a lie, a needlessly
 * labelled photo is only timid.
 */
export function isIllustration(key: string): boolean {
  return mediaKind(key) === 'render' || mediaKind(key) === undefined;
}

export const ILLUSTRATION_LABEL = 'Ilustrasi';
