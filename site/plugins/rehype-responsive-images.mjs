/**
 * Turn every <img> in a markdown body into a responsive picture.
 *
 * The exporter rewrote the old WordPress upload URLs to the optimised
 * `/media/...` paths. This plugin looks those paths up in the media
 * manifest and adds the srcset / dimensions / lazy-loading hints that the
 * manifest already knows about — so a blog post never downloads a 1600px
 * image on a phone.
 *
 * Runs as a rehype plugin, i.e. after markdown has been turned into HTML
 * but before Astro renders the page.
 *
 * It also carries PLAN.md F6 into article bodies: a page can label its own
 * <Picture>, but it cannot reach the images inside rendered markdown, so the
 * "Ilustrasi" label for a render is added here instead.
 *
 * CAREFUL: Astro caches the rendered article HTML in
 * node_modules/.astro/data-store.json. After changing this file the cache
 * keeps serving the old result — `npm run clean:content` (or deleting that
 * file) before rebuilding, otherwise the change looks like it did nothing.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, '..', 'src', 'data', 'media-manifest.json');
const kindsPath = path.join(here, '..', 'src', 'data', 'media-kinds.json');

let manifest = {};
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (error) {
  console.warn('[rehype-responsive-images] media manifest not loaded:', error.message);
}

/*
  Same record the pages read (src/data/media.ts): only a 'render' gets the
  label. A photograph needs none, a floor plan is a drawing rather than a
  promise, and a marketing poster is a document — labelling those "Ilustrasi"
  would say something untrue about them.
*/
let renders = new Set();
const ILLUSTRATION_LABEL = 'Ilustrasi';
try {
  const kinds = JSON.parse(readFileSync(kindsPath, 'utf-8'));
  renders = new Set(Object.keys(kinds.render ?? {}));
} catch (error) {
  console.warn('[rehype-responsive-images] media kinds not loaded:', error.message);
}

/** Images that must never be lazy — they are above the fold. */
const EAGER = /^\/media\/(curated\/hero|curated\/hero-2|curated\/hero-3)\./;

/**
 * `/media/curated/unit-4-800.webp` → `unit-4`.
 *
 * Kept in sync with mediaName() in src/data/media.ts — only a width suffix of
 * three digits or more is stripped, because the asset names themselves end in
 * numbers (`unit-4`, `design-45`). This copy exists because the file is
 * TypeScript and this plugin runs in the Astro config, before any of that.
 */
function assetName(src) {
  return src
    .replace(/^.*\/media\/(?:curated\/)?/, '')
    .replace(/-\d{3,4}\.webp$/, '')
    .replace(/\.webp$/, '');
}

function illustrationChip() {
  return {
    type: 'element',
    tagName: 'span',
    properties: { class: ['media-chip', 'media-chip--inline'] },
    children: [{ type: 'text', value: ILLUSTRATION_LABEL }],
  };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.children)) {
    visit(node);
    for (const child of node.children) walk(child, visit);
    return;
  }
  visit(node);
}

export function rehypeResponsiveImages() {
  return (tree) => {
    walk(tree, (parent) => {
      if (!Array.isArray(parent.children)) return;
      for (let i = parent.children.length - 1; i >= 0; i -= 1) {
        const node = parent.children[i];
        if (!node || node.type !== 'element' || node.tagName !== 'img') continue;
        labelImage(node, parent, i);
      }
    });
  };
}

function labelImage(node, parent, index) {
  const props = node.properties ?? (node.properties = {});
  const src = props.src;
  if (typeof src !== 'string' || !src.startsWith('/media/')) return;

  const entry = manifest[src];
  if (entry) {
    props.src = entry.src ?? src;
    if (entry.srcset) {
      props.srcset = entry.srcset;
      props.sizes = props.sizes ?? '(max-width: 720px) 100vw, 720px';
    }
    if (entry.width) props.width = entry.width;
    if (entry.height) props.height = entry.height;

    if (!props.loading) {
      props.loading = EAGER.test(src) ? 'eager' : 'lazy';
    }
    if (!props.decoding) props.decoding = 'async';
    if (props.loading === 'eager' && !props.fetchpriority) {
      props.fetchpriority = 'high';
    }
  }

  // F6: the label goes under the picture rather than on top of it — article
  // images sit in a text column, and a chip floating over a kitchen render
  // competes with the sentence the reader is halfway through.
  const name = assetName(props.src ?? src);
  if (renders.has(name)) {
    parent.children.splice(index + 1, 0, illustrationChip());
  } else if (process.env.VCV_MEDIA_DEBUG) {
    console.warn(`[media] no label for ${name} (${src})`);
  }
}

export default rehypeResponsiveImages;