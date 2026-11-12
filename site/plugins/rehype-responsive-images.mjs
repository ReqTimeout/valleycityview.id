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
 * PLAN.md F6 used to add an "Ilustrasi" chip under every render here (a page
 * cannot reach the images inside rendered markdown). Owner removed that label
 * site-wide on 12 Nov 2026, so this plugin now only handles responsive image
 * attributes; honesty lives in the alt text ("render, bukan foto").
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

let manifest = {};
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (error) {
  console.warn('[rehype-responsive-images] media manifest not loaded:', error.message);
}

/** Images that must never be lazy — they are above the fold. */
const EAGER = /^\/media\/(curated\/hero|curated\/hero-2|curated\/hero-3)\./;

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
        responsiveImage(node);
      }
    });
  };
}

function responsiveImage(node) {
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
}

export default rehypeResponsiveImages;